import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// Helper to get Token
async function getToken() {
    try {
        const password = 'admin';
        const passwordMd5 = crypto.createHash('md5').update(password).digest('hex');

        const loginRes = await fetch('http://localhost:8000/api/v1/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'admin',
                password: passwordMd5
            })
        });

        if (!loginRes.ok) return null;
        const data = await loginRes.json();
        return data.data?.token;
    } catch (e) {
        return null;
    }
}

// Proxy Handler
const proxyNms = async (req: express.Request, res: express.Response, endpoint: string) => {
    try {
        const token = await getToken();
        if (!token) return res.status(502).json({ error: 'NMS Auth Failed' });

        const response = await fetch(`http://localhost:8000/api/v1${endpoint}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: 'Proxy Error', message: error.message });
    }
};

router.get('/streams', (req, res) => proxyNms(req, res, '/streams'));
router.get('/stats', (req, res) => proxyNms(req, res, '/stats'));
router.get('/nms-check', (req, res) => proxyNms(req, res, '/streams')); // Legacy alias

export default router;
