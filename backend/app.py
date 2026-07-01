import cv2
import numpy as np
import mediapipe as mp
import math
import base64
import asyncio
import time
import os
import sqlite3
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="AI Gym Coach Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SQLite Database Setup
conn = sqlite3.connect("sessions.db", check_same_thread=False)
cursor = conn.cursor()
cursor.execute(
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise TEXT,
        reps INTEGER,
        tut TEXT,
        accuracy INTEGER,
        timestamp TEXT
    )
"""
)
conn.commit()


# Pydantic Model for API
class SessionData(BaseModel):
    exercise: str
    reps: int
    tut: str
    accuracy: int
    timestamp: str


@app.post("/api/sessions")
def save_session(session: SessionData):
    cursor.execute(
        """
        INSERT INTO sessions (exercise, reps, tut, accuracy, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """,
        (
            session.exercise,
            session.reps,
            session.tut,
            session.accuracy,
            session.timestamp,
        ),
    )
    conn.commit()
    return {"status": "success", "id": cursor.lastrowid}


@app.get("/api/sessions")
def get_sessions():
    cursor.execute(
        "SELECT id, exercise, reps, tut, accuracy, timestamp FROM sessions ORDER BY id DESC"
    )
    rows = cursor.fetchall()
    return [
        {
            "id": r[0],
            "exercise": r[1],
            "reps": r[2],
            "tut": r[3],
            "accuracy": r[4],
            "timestamp": r[5],
        }
        for r in rows
    ]


@app.delete("/api/sessions")
def clear_sessions():
    cursor.execute("DELETE FROM sessions")
    conn.commit()
    return {"status": "cleared"}


mp_drawing = mp.solutions.drawing_utils
mp_pose = mp.solutions.pose


def calculate_angle(p1, p2, p3):
    a = math.sqrt((p2[0] - p3[0]) ** 2 + (p2[1] - p3[1]) ** 2)
    b = math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)
    c = math.sqrt((p1[0] - p3[0]) ** 2 + (p1[1] - p3[1]) ** 2)
    if a == 0 or b == 0:
        return 0.0
    val = (a**2 + b**2 - c**2) / (2 * a * b)
    val = max(-1.0, min(1.0, val))
    angle = math.acos(val)
    return math.degrees(angle)


class SessionState:
    def __init__(self):
        self.exercise = "Bicep Curl"
        self.reset_requested = False
        self.is_tracking = False
        self.min_angle = 360
        self.max_angle = 0
        self.persistent_warning = False
        self.persistent_msg = ""
        self.warning_expiry = 0


async def receive_messages(websocket: WebSocket, state: SessionState):
    try:
        while True:
            data = await websocket.receive_json()
            if "exercise" in data:
                state.exercise = data["exercise"]
                state.min_angle = 360
                state.max_angle = 0
                state.persistent_warning = False
                print(f"Switched exercise to: {state.exercise}")
            if "action" in data:
                if data["action"] == "reset_session":
                    state.reset_requested = True
                elif data["action"] == "start_tracking":
                    state.is_tracking = True
                elif data["action"] == "stop_tracking":
                    state.is_tracking = False
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Error receiving: {e}")


# Audio Coach Engine
last_spoken_time = 0


def speak_warning(message):
    global last_spoken_time
    # 3 second cooldown to prevent spamming the audio engine
    if time.time() - last_spoken_time > 3.0:
        # Non-blocking native macOS TTS
        os.system(f'say "{message}" &')
        last_spoken_time = time.time()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Try index 1 first (FaceTime HD) to avoid iPhone Continuity Camera hijacking
    cap = cv2.VideoCapture(1)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)

    state = SessionState()
    receive_task = asyncio.create_task(receive_messages(websocket, state))

    counter = 0
    stage = "down"

    total_frames = 0
    warning_frames = 0

    # Time Under Tension (TUT) Backend Tracking
    active_tut_seconds = 0.0

    last_time = time.time()
    last_angle = 0
    velocity = 0

    with mp_pose.Pose(
        min_detection_confidence=0.7, min_tracking_confidence=0.7
    ) as pose:
        try:
            while True:
                current_time = time.time()
                dt = current_time - last_time
                last_time = current_time

                if not cap.isOpened():
                    cap.open(1)
                    if not cap.isOpened():
                        cap.open(0)

                ret, frame = cap.read()
                if not ret:
                    frame = np.zeros((480, 640, 3), dtype=np.uint8)
                    cv2.putText(
                        frame,
                        "No webcam signal",
                        (200, 240),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1,
                        (255, 255, 255),
                        2,
                    )
                    ret = True
                else:
                    # Mirror the frame horizontally for a natural gym experience
                    frame = cv2.flip(frame, 1)

                image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image.flags.writeable = False
                results = pose.process(image)

                image.flags.writeable = True
                image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

                if state.reset_requested:
                    counter = 0
                    total_frames = 0
                    warning_frames = 0
                    active_tut_seconds = 0.0
                    state.min_angle = 360
                    state.max_angle = 0
                    state.persistent_warning = False
                    state.reset_requested = False
                    state.is_tracking = False
                    stage = "down"

                # Increment TUT if in active phase
                if state.is_tracking and stage in ["up", "squatted"]:
                    active_tut_seconds += dt

                # Format TUT into mm:ss
                tut_int = int(active_tut_seconds)
                m = str(tut_int // 60).zfill(2)
                s = str(tut_int % 60).zfill(2)
                tut_formatted = f"{m}:{s}"

                telemetry = {
                    "angle": 0,
                    "reps": counter,
                    "stage": stage,
                    "warning": False,
                    "warning_message": "",
                    "velocity": 0.0,
                    "exercise": state.exercise,
                    "accuracy": 100,
                    "tut_formatted": tut_formatted,
                    "tut_raw": tut_int,
                    "is_tracking": state.is_tracking,
                }

                try:
                    if results.pose_landmarks:
                        landmarks = results.pose_landmarks.landmark
                        angle = 0
                        warning = False
                        warning_message = ""

                        if state.exercise == "Bicep Curl":
                            shoulder = [
                                landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].y,
                            ]
                            elbow = [
                                landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value].y,
                            ]
                            wrist = [
                                landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].y,
                            ]
                            hip = [
                                landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].y,
                            ]

                            angle = calculate_angle(shoulder, elbow, wrist)

                            if abs(shoulder[0] - hip[0]) > 0.15:
                                warning = True
                                warning_message = "Upper Arm Swinging"

                            if angle < 40:
                                if stage == "down":
                                    stage = "up"
                                    if state.is_tracking:
                                        counter += 1
                            elif angle > 150:
                                stage = "down"

                        elif state.exercise == "Squat":
                            hip = [
                                landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_HIP.value].y,
                            ]
                            knee = [
                                landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value].y,
                            ]
                            ankle = [
                                landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value].y,
                            ]

                            angle = calculate_angle(hip, knee, ankle)
                            state.min_angle = min(state.min_angle, angle)

                            if angle < 90:
                                if stage == "standing" or stage == "down":
                                    stage = "squatted"
                            elif angle > 160:
                                if stage == "squatted":
                                    stage = "standing"
                                    if state.is_tracking:
                                        counter += 1
                                    if state.min_angle > 90:
                                        state.persistent_warning = True
                                        state.persistent_msg = "Shallow Depth"
                                        state.warning_expiry = time.time() + 2.0
                                    state.min_angle = 360
                                elif stage == "down":
                                    stage = "standing"

                        elif state.exercise == "Shoulder Press":
                            shoulder = [
                                landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].y,
                            ]
                            elbow = [
                                landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value].y,
                            ]
                            wrist = [
                                landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].x,
                                landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].y,
                            ]

                            angle = calculate_angle(shoulder, elbow, wrist)
                            state.max_angle = max(state.max_angle, angle)

                            if angle > 160:
                                if stage == "down":
                                    stage = "up"
                            elif angle < 90:
                                if stage == "up":
                                    stage = "down"
                                    if state.is_tracking:
                                        counter += 1
                                    if state.max_angle < 160:
                                        state.persistent_warning = True
                                        state.persistent_msg = "Incomplete Extension"
                                        state.warning_expiry = time.time() + 2.0
                                    state.max_angle = 0
                                elif stage == "down":
                                    pass

                        if state.persistent_warning:
                            if time.time() > state.warning_expiry:
                                state.persistent_warning = False
                            else:
                                warning = True
                                warning_message = state.persistent_msg

                        if warning and state.is_tracking:
                            speak_warning(warning_message)

                        if dt > 0:
                            velocity = abs(angle - last_angle) / dt
                        last_angle = angle

                        if state.is_tracking:
                            total_frames += 1
                            if warning:
                                warning_frames += 1

                        accuracy = 100
                        if total_frames > 0:
                            accuracy = int(
                                ((total_frames - warning_frames) / total_frames) * 100
                            )

                        telemetry["angle"] = int(angle)
                        telemetry["warning"] = warning
                        telemetry["warning_message"] = warning_message
                        telemetry["stage"] = stage
                        telemetry["reps"] = counter
                        telemetry["velocity"] = int(min(velocity, 1000))
                        telemetry["accuracy"] = accuracy

                        mp_drawing.draw_landmarks(
                            image,
                            results.pose_landmarks,
                            mp_pose.POSE_CONNECTIONS,
                            mp_drawing.DrawingSpec(
                                color=(24, 216, 236), thickness=2, circle_radius=2
                            ),
                            mp_drawing.DrawingSpec(
                                color=(226, 43, 138), thickness=2, circle_radius=2
                            ),
                        )
                except Exception:
                    pass

                ret, buffer = cv2.imencode(
                    ".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80]
                )
                frame_b64 = base64.b64encode(buffer).decode("utf-8")

                payload = {
                    "frame": f"data:image/jpeg;base64,{frame_b64}",
                    "telemetry": telemetry,
                }

                await websocket.send_json(payload)
                await asyncio.sleep(0.01)

        except WebSocketDisconnect:
            print("Client disconnected")
        finally:
            receive_task.cancel()
            if cap.isOpened():
                cap.release()


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000)
