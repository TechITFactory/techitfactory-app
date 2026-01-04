import os
import logging
import json
from datetime import datetime
from flask import Flask, jsonify, request
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from pythonjsonlogger import jsonlogger

app = Flask(__name__)

# Configure JSON logging
logger = logging.getLogger()
logHandler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter('%(timestamp)s %(level)s %(message)s')
logHandler.setFormatter(formatter)
logger.addHandler(logHandler)
logger.setLevel(logging.INFO)

# Prometheus metrics
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'path', 'status']
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'path']
)

# Mock order data
orders = [
    {'id': 1, 'product_id': 1, 'product_name': 'Laptop Pro', 'quantity': 1, 'status': 'delivered', 'total': 1299.99, 'created_at': '2024-01-01T10:00:00Z'},
    {'id': 2, 'product_id': 2, 'product_name': 'Wireless Headphones', 'quantity': 2, 'status': 'shipped', 'total': 399.98, 'created_at': '2024-01-02T14:30:00Z'},
    {'id': 3, 'product_id': 3, 'product_name': 'Coffee Maker Deluxe', 'quantity': 1, 'status': 'pending', 'total': 89.99, 'created_at': '2024-01-03T09:15:00Z'},
    {'id': 4, 'product_id': 4, 'product_name': 'Smart Watch', 'quantity': 1, 'status': 'processing', 'total': 349.99, 'created_at': '2024-01-04T11:45:00Z'}
]

next_order_id = 5

@app.before_request
def before_request():
    request.start_time = datetime.now()

@app.after_request
def after_request(response):
    if hasattr(request, 'start_time'):
        latency = (datetime.now() - request.start_time).total_seconds()
        REQUEST_LATENCY.labels(method=request.method, path=request.path).observe(latency)
    
    REQUEST_COUNT.labels(method=request.method, path=request.path, status=response.status_code).inc()
    
    logger.info(json.dumps({
        'method': request.method,
        'path': request.path,
        'status': response.status_code
    }))
    
    return response

@app.route('/health')
def health():
    return jsonify({'status': 'healthy', 'service': 'order-service', 'timestamp': datetime.now().isoformat()})

@app.route('/ready')
def ready():
    return jsonify({'status': 'ready', 'service': 'order-service'})

@app.route('/metrics')
def metrics():
    return generate_latest(), 200, {'Content-Type': CONTENT_TYPE_LATEST}

@app.route('/orders', methods=['GET'])
def get_orders():
    status_filter = request.args.get('status')
    result = orders
    
    if status_filter:
        result = [o for o in orders if o['status'].lower() == status_filter.lower()]
    
    return jsonify({'orders': result, 'count': len(result)})

@app.route('/orders/<int:order_id>', methods=['GET'])
def get_order(order_id):
    order = next((o for o in orders if o['id'] == order_id), None)
    if not order:
        return jsonify({'error': 'Order not found'}), 404
    return jsonify(order)

@app.route('/orders', methods=['POST'])
def create_order():
    global next_order_id
    
    data = request.get_json()
    if not data or 'product_id' not in data:
        return jsonify({'error': 'product_id is required'}), 400
    
    new_order = {
        'id': next_order_id,
        'product_id': data['product_id'],
        'product_name': data.get('product_name', 'Unknown'),
        'quantity': data.get('quantity', 1),
        'status': 'pending',
        'total': data.get('total', 0),
        'created_at': datetime.now().isoformat()
    }
    
    orders.append(new_order)
    next_order_id += 1
    
    return jsonify(new_order), 201

@app.route('/orders/<int:order_id>/status', methods=['PATCH'])
def update_order_status(order_id):
    order = next((o for o in orders if o['id'] == order_id), None)
    if not order:
        return jsonify({'error': 'Order not found'}), 404
    
    data = request.get_json()
    if 'status' not in data:
        return jsonify({'error': 'status is required'}), 400
    
    valid_statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
    if data['status'] not in valid_statuses:
        return jsonify({'error': f'Invalid status. Must be one of: {valid_statuses}'}), 400
    
    order['status'] = data['status']
    return jsonify(order)

@app.route('/')
def root():
    return jsonify({'service': 'Order Service', 'version': '1.0.0'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=False)
