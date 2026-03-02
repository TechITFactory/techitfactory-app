const express = require('express');
const axios = require('axios');
const client = require('prom-client');
const winston = require('winston');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Service URLs from environment
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service';
const CART_SERVICE_URL = process.env.CART_SERVICE_URL || 'http://cart-service';

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
client.collectDefaultMetrics();

const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status']
});

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'path', 'status'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

// CORS — restrict to configured origins (never open in production)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost', 'http://localhost:3000', 'http://localhost:8080'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow server-to-server (no origin) and listed origins
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error(`CORS blocked: ${origin} not in allowed list`));
    },
    credentials: true
}));
app.use(express.json());

// Request logging & metrics middleware
app.use((req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const labels = { method: req.method, path: req.route?.path || req.path, status: res.statusCode };

        httpRequestsTotal.inc(labels);
        httpRequestDuration.observe(labels, duration);

        logger.info({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}s`
        });
    });

    next();
});

// Health endpoints
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'api-gateway', timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
    res.json({ status: 'ready', service: 'api-gateway' });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

// API Routes - Products
app.get('/api/products', async (req, res) => {
    try {
        const response = await axios.get(`${PRODUCT_SERVICE_URL}/products`, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        logger.error({ message: 'Product service error', error: error.message });
        res.status(503).json({ error: 'Product service unavailable', details: error.message });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const response = await axios.get(`${PRODUCT_SERVICE_URL}/products/${req.params.id}`, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 404) {
            return res.status(404).json({ error: 'Product not found' });
        }
        logger.error({ message: 'Product service error', error: error.message });
        res.status(503).json({ error: 'Product service unavailable' });
    }
});

// API Routes - Orders
app.get('/api/orders', async (req, res) => {
    try {
        const response = await axios.get(`${ORDER_SERVICE_URL}/orders`, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        logger.error({ message: 'Order service error', error: error.message });
        res.status(503).json({ error: 'Order service unavailable', details: error.message });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const response = await axios.post(`${ORDER_SERVICE_URL}/orders`, req.body, { timeout: 5000 });
        res.status(201).json(response.data);
    } catch (error) {
        logger.error({ message: 'Order service error', error: error.message });
        res.status(503).json({ error: 'Order service unavailable' });
    }
});

app.patch('/api/orders/:id/status', async (req, res) => {
    try {
        const response = await axios.patch(`${ORDER_SERVICE_URL}/orders/${req.params.id}/status`, req.body, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 404) return res.status(404).json({ error: 'Order not found' });
        logger.error({ message: 'Order service error', error: error.message });
        res.status(503).json({ error: 'Order service unavailable' });
    }
});

// API Routes - Cart
app.get('/api/cart/:userId', async (req, res) => {
    try {
        const response = await axios.get(`${CART_SERVICE_URL}/cart/${req.params.userId}`, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        logger.error({ message: 'Cart service error', error: error.message });
        res.status(503).json({ error: 'Cart service unavailable' });
    }
});

app.post('/api/cart/:userId/items', async (req, res) => {
    try {
        const response = await axios.post(`${CART_SERVICE_URL}/cart/${req.params.userId}/items`, req.body, { timeout: 5000 });
        res.status(201).json(response.data);
    } catch (error) {
        if (error.response?.status === 400) return res.status(400).json(error.response.data);
        logger.error({ message: 'Cart service error', error: error.message });
        res.status(503).json({ error: 'Cart service unavailable' });
    }
});

app.patch('/api/cart/:userId/items/:productId', async (req, res) => {
    try {
        const response = await axios.patch(`${CART_SERVICE_URL}/cart/${req.params.userId}/items/${req.params.productId}`, req.body, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 404) return res.status(404).json(error.response.data);
        logger.error({ message: 'Cart service error', error: error.message });
        res.status(503).json({ error: 'Cart service unavailable' });
    }
});

app.delete('/api/cart/:userId/items/:productId', async (req, res) => {
    try {
        const response = await axios.delete(`${CART_SERVICE_URL}/cart/${req.params.userId}/items/${req.params.productId}`, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 404) return res.status(404).json(error.response.data);
        logger.error({ message: 'Cart service error', error: error.message });
        res.status(503).json({ error: 'Cart service unavailable' });
    }
});

app.delete('/api/cart/:userId', async (req, res) => {
    try {
        const response = await axios.delete(`${CART_SERVICE_URL}/cart/${req.params.userId}`, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        logger.error({ message: 'Cart service error', error: error.message });
        res.status(503).json({ error: 'Cart service unavailable' });
    }
});

// API Routes - Users (proxy — auth handled by user-service)
app.post('/api/users/register', async (req, res) => {
    try {
        const response = await axios.post(`${USER_SERVICE_URL}/users/register`, req.body, { timeout: 5000 });
        res.status(201).json(response.data);
    } catch (error) {
        if (error.response?.status === 409) return res.status(409).json(error.response.data);
        if (error.response?.status === 400) return res.status(400).json(error.response.data);
        logger.error({ message: 'User service error', error: error.message });
        res.status(503).json({ error: 'User service unavailable' });
    }
});

app.post('/api/users/login', async (req, res) => {
    try {
        const response = await axios.post(`${USER_SERVICE_URL}/users/login`, req.body, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 401) return res.status(401).json(error.response.data);
        if (error.response?.status === 400) return res.status(400).json(error.response.data);
        logger.error({ message: 'User service error', error: error.message });
        res.status(503).json({ error: 'User service unavailable' });
    }
});

app.get('/api/users/me', async (req, res) => {
    try {
        const response = await axios.get(`${USER_SERVICE_URL}/users/me`, {
            timeout: 5000,
            headers: { authorization: req.headers.authorization }
        });
        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 401) return res.status(401).json(error.response.data);
        logger.error({ message: 'User service error', error: error.message });
        res.status(503).json({ error: 'User service unavailable' });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        service: 'TechITFactory API Gateway',
        version: '1.0.0',
        endpoints: [
            '/api/products', '/api/products/:id',
            '/api/orders', '/api/orders/:id/status',
            '/api/cart/:userId', '/api/cart/:userId/items',
            '/api/users/register', '/api/users/login', '/api/users/me',
            '/health', '/ready', '/metrics'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    logger.info({ message: `API Gateway listening on port ${PORT}`, port: PORT });
});
