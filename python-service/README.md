# Python Financial Calculator Microservice

A high-precision financial calculation service using pandas for Tally data analysis.

## Setup

1. Install dependencies:
```bash
cd python-service
pip install -r requirements.txt
```

2. Start the service:
```bash
python app.py
```

The service will run on `http://localhost:5001`

## API Endpoints

### POST /calculate/sales
Calculate sales totals with date filtering and breakdowns.

### POST /calculate/profit  
Calculate profit/loss with revenue and expense analysis.

### GET /health
Health check endpoint.

## Architecture Benefits

- **Separation of Concerns**: Pure Python service for calculations
- **Independent Scaling**: Can scale calculation service separately
- **Clean Dependencies**: No mixing of Node.js and Python dependencies
- **Production Ready**: Proper microservice architecture
