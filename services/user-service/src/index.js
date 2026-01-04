const express = require('express');
const client = require('prom-client');
const winston = require('winston');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'techitfactory-secret-key';

// Logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()]
});

// Prometheus Metrics
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ timeout: 5000 });

const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status']
});

// Mock user database
const users = [
    { id: 1, email: 'admin@techitfactory.com', password: bcrypt.hashSync('admin123', 10), role: 'admin', name: 'Admin User' },
    { id: 2, email: 'user@techitfactory.com', password: bcrypt.hashSync('user123', 10), role: 'user', name: 'Regular User' }
];

let nextUserId = 3;

// Middleware
app.use(express.json());

app.use((req, res, next) => {
    res.on('finish', () => {
        httpRequestsTotal.inc({ method: req.method, path: req.route?.path || req.path, status: res.statusCode });
        logger.info({ method: req.method, path: req.path, status: res.statusCode });
    });
    next();
});

// Auth middleware
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Health endpoints
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'user-service', timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
    res.json({ status: 'ready', service: 'user-service' });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

// Register
app.post('/users/register', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ error: 'email, password, and name are required' });
    }

    if (users.find(u => u.email === email)) {
        return res.status(409).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: nextUserId++,
        email,
        password: hashedPassword,
        role: 'user',
        name
    };

    users.push(newUser);
    logger.info({ action: 'user_registered', userId: newUser.id, email });

    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
});

// Login
app.post('/users/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    const user = users.find(u => u.email === email);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });

    logger.info({ action: 'user_login', userId: user.id, email });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// Get current user
app.get('/users/me', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
});

// List users (admin only)
app.get('/users', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    const usersWithoutPasswords = users.map(({ password: _, ...user }) => user);
    res.json({ users: usersWithoutPasswords, count: users.length });
});

// Root
app.get('/', (req, res) => {
    res.json({ service: 'User Service', version: '1.0.0' });
});

// Start server
app.listen(PORT, () => {
    logger.info({ message: `User Service listening on port ${PORT}`, port: PORT });
});
