
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './Home';
import { AdminDashboard } from './pages/AdminDashboard';

function App() {
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/admin" element={<AdminDashboard />} />
        </Routes>
    );
}

export default App;
