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

// In-memory cart storage (use Redis in production)
const carts = new Map();

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
    res.json({ status: 'healthy', service: 'cart-service', timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
    res.json({ status: 'ready', service: 'cart-service' });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

// Get cart for user
app.get('/cart/:userId', (req, res) => {
    const { userId } = req.params;
    const cart = carts.get(userId) || { userId, items: [], total: 0 };
    res.json(cart);
});

// Add item to cart
app.post('/cart/:userId/items', (req, res) => {
    const { userId } = req.params;
    const { productId, productName, price, quantity = 1 } = req.body;

    if (!productId || !price) {
        return res.status(400).json({ error: 'productId and price are required' });
    }

    let cart = carts.get(userId);
    if (!cart) {
        cart = { userId, items: [], total: 0 };
    }

    // Check if item exists
    const existingItem = cart.items.find(item => item.productId === productId);
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        cart.items.push({
            productId,
            productName: productName || `Product ${productId}`,
            price,
            quantity
        });
    }

    // Recalculate total
    cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    carts.set(userId, cart);
    logger.info({ action: 'item_added', userId, productId, quantity });

    res.status(201).json(cart);
});

// Update item quantity
app.patch('/cart/:userId/items/:productId', (req, res) => {
    const { userId, productId } = req.params;
    const { quantity } = req.body;

    const cart = carts.get(userId);
    if (!cart) {
        return res.status(404).json({ error: 'Cart not found' });
    }

    const item = cart.items.find(i => i.productId === parseInt(productId));
    if (!item) {
        return res.status(404).json({ error: 'Item not found in cart' });
    }

    if (quantity <= 0) {
        cart.items = cart.items.filter(i => i.productId !== parseInt(productId));
    } else {
        item.quantity = quantity;
    }

    cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    carts.set(userId, cart);

    res.json(cart);
});

// Remove item from cart
app.delete('/cart/:userId/items/:productId', (req, res) => {
    const { userId, productId } = req.params;

    const cart = carts.get(userId);
    if (!cart) {
        return res.status(404).json({ error: 'Cart not found' });
    }

    cart.items = cart.items.filter(i => i.productId !== parseInt(productId));
    cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    carts.set(userId, cart);

    logger.info({ action: 'item_removed', userId, productId });
    res.json(cart);
});

// Clear cart
app.delete('/cart/:userId', (req, res) => {
    const { userId } = req.params;
    carts.delete(userId);
    logger.info({ action: 'cart_cleared', userId });
    res.json({ message: 'Cart cleared', userId });
});

// Root
app.get('/', (req, res) => {
    res.json({ service: 'Cart Service', version: '1.0.0' });
});

// Start server
app.listen(PORT, () => {
    logger.info({ message: `Cart Service listening on port ${PORT}`, port: PORT });
});
