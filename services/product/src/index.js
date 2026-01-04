const express = require('express');
const client = require('prom-client');
const winston = require('winston');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Mock product data
const products = [
    { id: 1, name: 'Laptop Pro', price: 1299.99, category: 'Electronics', stock: 50, description: 'High-performance laptop' },
    { id: 2, name: 'Wireless Headphones', price: 199.99, category: 'Electronics', stock: 150, description: 'Noise-canceling headphones' },
    { id: 3, name: 'Coffee Maker Deluxe', price: 89.99, category: 'Kitchen', stock: 75, description: 'Programmable coffee maker' },
    { id: 4, name: 'Smart Watch', price: 349.99, category: 'Electronics', stock: 100, description: 'Fitness tracking smartwatch' },
    { id: 5, name: 'Mechanical Keyboard', price: 149.99, category: 'Electronics', stock: 200, description: 'RGB mechanical keyboard' }
];

// Middleware
app.use(express.json());

app.use((req, res, next) => {
    res.on('finish', () => {
        httpRequestsTotal.inc({ method: req.method, path: req.route?.path || req.path, status: res.statusCode });
        logger.info({ method: req.method, path: req.path, status: res.statusCode });
    });
    next();
});

// Health endpoints
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'product-service', timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
    res.json({ status: 'ready', service: 'product-service' });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

// Product routes
app.get('/products', (req, res) => {
    const { category, minPrice, maxPrice } = req.query;
    let result = [...products];

    if (category) {
        result = result.filter(p => p.category.toLowerCase() === category.toLowerCase());
    }
    if (minPrice) {
        result = result.filter(p => p.price >= parseFloat(minPrice));
    }
    if (maxPrice) {
        result = result.filter(p => p.price <= parseFloat(maxPrice));
    }

    res.json({ products: result, count: result.length });
});

app.get('/products/:id', (req, res) => {
    const product = products.find(p => p.id === parseInt(req.params.id));
    if (!product) {
        return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
});

// Categories
app.get('/categories', (req, res) => {
    const categories = [...new Set(products.map(p => p.category))];
    res.json({ categories });
});

// Root
app.get('/', (req, res) => {
    res.json({ service: 'Product Service', version: '1.0.0' });
});

// Start server
app.listen(PORT, () => {
    logger.info({ message: `Product Service listening on port ${PORT}`, port: PORT });
});
