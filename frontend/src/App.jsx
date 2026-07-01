import React, { useEffect, useState, useRef } from 'react';
import { Activity, AlertTriangle, Crosshair, Dumbbell, Zap, Clock, ListOrdered, CheckCircle2, Power, Volume2, Trash2, Play, Pause } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis, XAxis, ReferenceLine } from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

function App() {
  const [frame, setFrame] = useState(null);
  const [telemetry, setTelemetry] = useState({
    angle: 0,
    reps: 0,
    stage: 'down',
    warning: false,
    warning_message: '',
    velocity: 0,
    exercise: 'Bicep Curl',
    accuracy: 100,
    tut_formatted: '00:00',
    tut_raw: 0,
    is_tracking: false
  });
  
  const [isEngineOn, setIsEngineOn] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [velocityData, setVelocityData] = useState([]);
  const [sessionHistory, setSessionHistory] = useState([]);
  
  const ws = useRef(null);

  // Load Session History from SQLite Database on Mount
  useEffect(() => {
    fetch(`${API_URL}/api/sessions`)
      .then(res => res.json())
      .then(data => setSessionHistory(data))
      .catch(err => console.error("Error loading history:", err));
  }, []);

  useEffect(() => {
    let reconnectTimeout;
    
    const connect = () => {
      if (!isEngineOn) return;
      
      ws.current = new WebSocket(`${WS_URL}/ws`);

      ws.current.onopen = () => {
        setIsConnected(true);
      };

      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.frame) setFrame(data.frame);
        if (data.telemetry) {
          setTelemetry(data.telemetry);
          
          setVelocityData(prev => {
            const newData = [...prev, { 
              time: new Date().toLocaleTimeString(), 
              velocity: data.telemetry.velocity,
              target: 400 
            }];
            if (newData.length > 30) return newData.slice(newData.length - 30);
            return newData;
          });
        }
      };

      ws.current.onclose = () => {
        setIsConnected(false);
        if (isEngineOn) {
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };
      
      ws.current.onerror = () => {
        ws.current.close();
      };
    };

    if (isEngineOn) {
      connect();
    } else {
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
        ws.current = null;
      }
      setIsConnected(false);
      setFrame(null);
    }

    return () => {
      clearTimeout(reconnectTimeout);
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, [isEngineOn]);

  const handleExerciseChange = (e) => {
    const newExercise = e.target.value;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ exercise: newExercise }));
    }
  };

  const toggleEngine = () => {
    setIsEngineOn(!isEngineOn);
  };

  const toggleTracking = () => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const action = telemetry.is_tracking ? 'stop_tracking' : 'start_tracking';
      ws.current.send(JSON.stringify({ action }));
    }
  };

  const handleFinishSet = async () => {
    if (telemetry.reps > 0 || telemetry.tut_raw > 0) {
      const newSet = {
        exercise: telemetry.exercise,
        reps: telemetry.reps,
        tut: telemetry.tut_formatted,
        accuracy: telemetry.accuracy,
        timestamp: new Date().toLocaleTimeString()
      };
      
      try {
        const response = await fetch(`${API_URL}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSet)
        });
        const result = await response.json();
        
        newSet.id = result.id;
        setSessionHistory([newSet, ...sessionHistory]);
      } catch (err) {
        console.error("Error saving set to DB:", err);
      }
      
      setTelemetry(prev => ({ ...prev, reps: 0, accuracy: 100, tut_formatted: '00:00', tut_raw: 0, is_tracking: false }));
      
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ action: 'reset_session' }));
      }
    }
  };

  const handleClearHistory = async () => {
    try {
      await fetch(`${API_URL}/api/sessions`, { method: 'DELETE' });
      setSessionHistory([]);
    } catch (err) {
      console.error("Error clearing history:", err);
    }
  };

  const angleNormalized = Math.max(0, Math.min(100, ((160 - telemetry.angle) / 130) * 100));
  const arcStrokeDasharray = 283;
  const arcStrokeDashoffset = arcStrokeDasharray - (arcStrokeDasharray * angleNormalized) / 100;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-6 md:p-8 flex flex-col">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-white shadow-sm">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">AI Form Coach</h1>
            <p className="text-sm text-gray-500">Smart Training Assistant</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs text-gray-600 shadow-sm">
            <Volume2 className="w-4 h-4 text-accent" />
            <span>Audio Coach Active</span>
          </div>

          <select 
            onChange={handleExerciseChange}
            value={telemetry.exercise}
            className="bg-white border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-accent focus:border-accent block p-2.5 shadow-sm outline-none"
          >
            <option value="Bicep Curl">Bicep Curl</option>
            <option value="Squat">Squat</option>
            <option value="Shoulder Press">Shoulder Press</option>
          </select>
          
          <div className="flex items-center gap-3 card-panel px-4 py-2 rounded-xl">
            <span className="text-sm font-semibold text-gray-600">Camera</span>
            <button 
              onClick={toggleEngine}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isEngineOn ? 'bg-accent' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${isEngineOn ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          
          <div className="flex items-center gap-2 px-4 py-2 rounded-full card-panel">
            {isConnected ? (
              <>
                <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                <span className="text-sm font-medium text-gray-700">Online</span>
              </>
            ) : (
              <>
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                <span className="text-sm font-medium text-gray-700">Standby</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        
        {/* Left Col */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Video Feed */}
          <div className={`relative flex-1 min-h-[480px] rounded-2xl overflow-hidden card-panel ${telemetry.warning ? 'ring-2 ring-warning' : ''}`}>
            <div className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-lg bg-white/90 backdrop-blur-md border border-gray-200 flex items-center gap-2 shadow-sm">
              <Crosshair className="w-4 h-4 text-accent" />
              <span className="text-xs font-bold tracking-wider text-gray-700 uppercase">Live Feed</span>
            </div>
            
            {frame && isEngineOn ? (
              <img src={frame} alt="Video Feed" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50">
                <Power className="w-12 h-12 mb-4 opacity-50" />
                <p>{isEngineOn ? "Waiting for video stream..." : "Camera is off. Toggle Camera to start."}</p>
              </div>
            )}
            
            {/* Start Tracking Overlay if not tracking */}
            {isEngineOn && isConnected && !telemetry.is_tracking && (
              <div className="absolute inset-0 bg-black/5 flex flex-col items-center justify-center backdrop-blur-[1px]">
                <button
                  onClick={toggleTracking}
                  className="px-6 py-3 rounded-xl bg-accent text-white font-bold text-lg shadow-lg hover:bg-emerald-400 transition-colors flex items-center gap-2"
                >
                  <Play className="w-6 h-6" /> Start Exercise
                </button>
              </div>
            )}
          </div>
          
          {/* Bottom Module: Velocity Chart & Session History */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Live Velocity Chart */}
            <div className="card-panel rounded-2xl p-6 h-64 flex flex-col">
              <h2 className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4" /> Movement Velocity
              </h2>
              <div className="flex-1 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={velocityData}>
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={[0, 1000]} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', color: '#111827' }}
                      labelStyle={{ display: 'none' }}
                      itemStyle={{ color: '#10b981', fontWeight: 'bold' }}
                    />
                    <ReferenceLine y={400} stroke="#ef4444" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="velocity" stroke="#10b981" strokeWidth={3} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Session History */}
            <div className="card-panel rounded-2xl p-6 h-64 flex flex-col overflow-hidden relative">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-gray-500 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <ListOrdered className="w-4 h-4" /> Activity Log
                </h2>
                {sessionHistory.length > 0 && (
                  <button onClick={handleClearHistory} className="text-gray-400 hover:text-red-500 transition-colors" title="Clear History">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto pr-2 space-y-2">
                {sessionHistory.length === 0 ? (
                  <div className="text-gray-400 text-sm h-full flex items-center justify-center">No previous sessions.</div>
                ) : (
                  (Array.isArray(sessionHistory) ? sessionHistory : []).map((set) => (
                      <div key={set.id} className="flex justify-between items-center p-3 rounded-xl bg-gray-50 border border-gray-100 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 font-bold w-8">#{set.id}</span>
                        <span className="font-semibold text-gray-800">{set.exercise}</span>
                      </div>
                      <div className="flex gap-4 text-gray-500">
                        <span><strong className="text-gray-900">{set.reps}</strong> Reps</span>
                        <span><strong className="text-gray-900">{set.tut}</strong> Time</span>
                        <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold text-xs">{set.accuracy}%</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Col */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Tracking Control Block */}
          {telemetry.is_tracking ? (
            <button 
              onClick={toggleTracking}
              className="w-full py-4 rounded-xl bg-gray-100 text-gray-700 border border-gray-200 font-bold text-lg hover:bg-gray-200 transition-colors shadow-sm flex justify-center items-center gap-2"
            >
              <Pause className="w-5 h-5" /> Pause Exercise
            </button>
          ) : (
            <button 
              onClick={toggleTracking}
              className="w-full py-4 rounded-xl bg-accent text-white font-bold text-lg hover:bg-emerald-400 transition-colors shadow-sm flex justify-center items-center gap-2"
            >
              <Play className="w-5 h-5" /> Start Exercise
            </button>
          )}

          {/* Rep Counter Block */}
          <div className="card-panel rounded-2xl p-6 relative overflow-hidden flex flex-col items-center justify-center min-h-[200px]">
            <div className="absolute -top-6 -right-6 text-gray-100">
              <Dumbbell className="w-40 h-40 transform rotate-12" />
            </div>
            <h2 className="text-gray-500 text-sm font-bold uppercase tracking-widest mb-2 z-10">Completed Reps</h2>
            <div className="text-7xl font-black text-gray-900 z-10">
              {telemetry.reps}
            </div>
            <div className="mt-4 flex gap-2 z-10 w-full">
              <div className="flex-1 px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center">
                <span className="text-xs font-medium text-gray-500">Motion Phase: <span className="uppercase text-accent ml-1 font-bold">{telemetry.stage}</span></span>
              </div>
            </div>
          </div>

          {/* Time Under Tension */}
          <div className="card-panel rounded-2xl p-6 flex items-center justify-between">
            <div>
              <h2 className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Duration
              </h2>
              <p className="text-sm text-gray-400">Active engagement</p>
            </div>
            <div className="text-3xl font-bold font-mono text-gray-900">
              {telemetry.tut_formatted}
            </div>
          </div>

          {/* Angle Progress Block */}
          <div className="card-panel rounded-2xl p-6 flex flex-col items-center justify-center">
            <h2 className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-6 w-full text-left flex justify-between">
              <span>Joint Angle</span>
              <span className="text-accent">{telemetry.accuracy}% Form</span>
            </h2>
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="72" cy="72" r="45" className="stroke-current text-gray-100" strokeWidth="8" fill="none" />
                <circle 
                  cx="72" cy="72" r="45" 
                  className="stroke-current text-accent transition-all duration-100 ease-linear" 
                  strokeWidth="8" fill="none" 
                  strokeDasharray={arcStrokeDasharray} strokeDashoffset={arcStrokeDashoffset} strokeLinecap="round" 
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-gray-900">{telemetry.angle}°</span>
              </div>
            </div>
          </div>

          {/* Warning Badge */}
          <div className={`rounded-2xl p-5 border transition-colors duration-300 ${telemetry.warning ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
            <h2 className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4" /> Form Feedback
            </h2>
            {telemetry.warning ? (
              <div className="flex items-start gap-3 text-warning">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <h3 className="font-bold text-sm mb-0.5">Adjustment Needed</h3>
                  <p className="text-xs text-red-600 font-medium">{telemetry.warning_message}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-accent">
                <div className="w-2 h-2 rounded-full bg-accent"></div>
                <span className="font-semibold text-sm">Perfect Execution</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <button 
            onClick={handleFinishSet}
            className="w-full py-4 rounded-xl bg-gray-900 text-white font-bold text-lg hover:bg-gray-800 transition-colors shadow-sm flex justify-center items-center gap-2 mt-auto"
          >
            <CheckCircle2 className="w-5 h-5" /> Finish Set
          </button>
          
        </div>
      </div>
    </div>
  );
}

export default App;
