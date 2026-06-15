
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './Home';
import { AdminDashboard } from './pages/AdminDashboard';
import { Terms } from './pages/Terms';
import { Privacy } from './pages/Privacy';
import { NotFound } from './pages/NotFound';

function App() {
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}

export default App;
