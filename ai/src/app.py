import os
import json
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from prophet import Prophet
import pandas as pd
import redis
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

# Initialize Redis client
redis_client = redis.Redis(
    host=os.getenv('REDIS_HOST', 'localhost'),
    port=int(os.getenv('REDIS_PORT', 6379)),
    db=0,
    decode_responses=True
)

# Constants
MIN_DATA_POINTS = 30
FORECAST_DAYS = 30
CACHE_TTL = 86400  # 24 hours in seconds

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/forecast', methods=['POST'])
def generate_forecast():
    """Generate demand forecast for a product"""
    try:
        data = request.get_json()
        
        if not data or 'sales_data' not in data:
            return jsonify({'error': 'Missing sales_data in request'}), 400
        
        product_id = data.get('product_id', 'unknown')
        sales_data = data['sales_data']
        
        # Check cache first
        cache_key = f"forecast:{product_id}"
        cached_result = redis_client.get(cache_key)
        if cached_result:
            logger.info(f"Returning cached forecast for product {product_id}")
            return jsonify(json.loads(cached_result))
        
        # Prepare data for Prophet
        df = pd.DataFrame(sales_data)
        df['ds'] = pd.to_datetime(df['ds'])
        df['y'] = pd.to_numeric(df['y'], errors='coerce')
        
        # Remove any rows with NaN values
        df = df.dropna()
        
        # Check if we have enough data
        if len(df) < MIN_DATA_POINTS:
            logger.warning(f"Insufficient data for product {product_id}, using moving average")
            # Fallback to 7-day moving average
            forecast = generate_moving_average_forecast(df, FORECAST_DAYS)
            confidence_level = 'low'
        else:
            # Use Prophet for forecasting
            logger.info(f"Generating Prophet forecast for product {product_id}")
            forecast = generate_prophet_forecast(df, FORECAST_DAYS)
            confidence_level = 'high' if len(df) > 90 else 'medium'
        
        # Prepare response
        response = {
            'product_id': product_id,
            'forecasts': forecast,
            'confidence_level': confidence_level,
            'generated_at': datetime.utcnow().isoformat()
        }
        
        # Cache the result
        redis_client.setex(cache_key, CACHE_TTL, json.dumps(response))
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Error generating forecast: {str(e)}")
        return jsonify({'error': str(e)}), 500

def generate_prophet_forecast(df, days_ahead):
    """Generate forecast using Prophet"""
    # Initialize and fit the model
    model = Prophet(
        daily_seasonality=True,
        weekly_seasonality=True,
        yearly_seasonality=False,  # Disable if less than 2 years of data
        changepoint_prior_scale=0.05
    )
    
    # Suppress Prophet's verbose output
    with suppress_stdout_stderr():
        model.fit(df)
    
    # Make future dataframe
    future = model.make_future_dataframe(periods=days_ahead)
    
    # Generate forecast
    forecast = model.predict(future)
    
    # Extract relevant columns for the future dates only
    future_forecast = forecast[forecast['ds'] > df['ds'].max()][['ds', 'yhat', 'yhat_lower', 'yhat_upper']]
    
    # Format the forecast
    formatted_forecast = []
    for _, row in future_forecast.iterrows():
        formatted_forecast.append({
            'date': row['ds'].strftime('%Y-%m-%d'),
            'predicted_demand': max(0, round(row['yhat'], 2)),  # Ensure non-negative
            'lower_bound': max(0, round(row['yhat_lower'], 2)),
            'upper_bound': max(0, round(row['yhat_upper'], 2))
        })
    
    return formatted_forecast

def generate_moving_average_forecast(df, days_ahead):
    """Generate forecast using simple moving average"""
    # Calculate 7-day moving average
    window_size = min(7, len(df))
    recent_avg = df.tail(window_size)['y'].mean()
    
    # Generate forecast
    forecast = []
    last_date = df['ds'].max()
    
    for i in range(1, days_ahead + 1):
        forecast_date = last_date + timedelta(days=i)
        forecast.append({
            'date': forecast_date.strftime('%Y-%m-%d'),
            'predicted_demand': max(0, round(recent_avg, 2)),
            'lower_bound': max(0, round(recent_avg * 0.8, 2)),
            'upper_bound': max(0, round(recent_avg * 1.2, 2))
        })
    
    return forecast

class suppress_stdout_stderr:
    """Context manager to suppress stdout and stderr"""
    def __enter__(self):
        self.old_stdout = os.dup(1)
        self.old_stderr = os.dup(2)
        os.close(1)
        os.close(2)
        os.open(os.devnull, os.O_RDWR)
        
    def __exit__(self, *args):
        os.dup2(self.old_stdout, 1)
        os.dup2(self.old_stderr, 2)
        os.close(self.old_stdout)
        os.close(self.old_stderr)

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=os.getenv('FLASK_ENV') == 'development')