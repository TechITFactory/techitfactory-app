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

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'path', 'status'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

// Middleware
app.use(cors());
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

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        service: 'TechITFactory API Gateway',
        version: '1.0.0',
        endpoints: ['/api/products', '/api/orders', '/health', '/ready', '/metrics']
    });
});

// Start server
app.listen(PORT, () => {
    logger.info({ message: `API Gateway listening on port ${PORT}`, port: PORT });
});
