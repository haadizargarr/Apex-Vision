# Apex Vision

## 📝 Project Overview

**What is the project?**
Apex Vision is an intelligent, real-time AI fitness coach. The application leverages a low-latency bi-directional WebSocket architecture to stream telemetry between a Vite/React frontend and a high-performance Python FastAPI backend. It utilizes OpenCV and MediaPipe for continuous, real-time computer vision and biomechanical posture analysis, persisting session telemetry via an embedded SQLite database.

**Why did you build it?**
This project serves as a 3rd-year Computer Science portfolio prototype at Taylor's University. It was engineered specifically to master advanced algorithmic design, real-time data streaming pipelines, and intelligent system implementation in full-stack environments.

**Current Status:**
Functional Prototype

## 🛠️ Tech Stack & Technologies Used

- **Frontend Core:** React (v19), Vite
- **Frontend UI & Data Visualization:** Tailwind CSS, Recharts, Lucide React
- **Backend Framework & Server:** Python 3, FastAPI, Uvicorn
- **AI & Computer Vision:** OpenCV-Python, MediaPipe
- **Real-Time Communication:** WebSockets
- **Database Persistence:** SQLite

## ✨ Core Features

- **Real-Time Biomechanical Tracking:** Employs MediaPipe pose estimation mapped through custom algebraic angle calculations to autonomously track joint mechanics for Bicep Curls, Squats, and Shoulder Presses.
- **Asynchronous Telemetry Engine:** Utilizes Python's `asyncio` to handle concurrent WebSocket event streams while independently maintaining a continuous computer vision processing loop.
- **Audio Feedback Subsystem:** Integrates non-blocking, native Text-to-Speech (TTS) capabilities to provide immediate, actionable feedback on poor exercise form.
- **Dynamic Data Visualization Dashboard:** A responsive React UI leveraging Recharts to map real-time performance vectors such as movement velocity, form accuracy, repetitions, and Time Under Tension (TUT).

## 💻 How to Run the Project

Follow these steps to build and run the application locally:

**1. Initialize and Start the Backend**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

**2. Initialize and Start the Frontend**
```bash
cd frontend
npm install
npm run dev
```
The client dashboard will be available at `http://localhost:5173` while the backend runs on `http://localhost:8000`.

## 📸 Visuals & Interface

*[Placeholder: Insert high-resolution screenshots of the React telemetry dashboard and real-time posture tracking views here]*
