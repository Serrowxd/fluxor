import os
import json
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from prophet import Prophet
import pandas as pd
import redis
from dotenv import load_dotenv
import logging
import numpy as np
from typing import Dict, List, Any, Optional

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
        external_factors = data.get('external_factors', [])
        forecast_horizon = data.get('forecast_horizon', FORECAST_DAYS)
        multi_step = data.get('multi_step', False)
        
        # Check cache first
        cache_key = f"forecast:{product_id}:{forecast_horizon}:{len(external_factors)}"
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
            forecast = generate_moving_average_forecast(df, forecast_horizon)
            confidence_level = 'low'
            model_used = 'moving_average'
        else:
            # Use Prophet for forecasting
            logger.info(f"Generating Prophet forecast for product {product_id}")
            if multi_step:
                forecast = generate_multi_step_forecast(df, external_factors)
            else:
                forecast = generate_enhanced_prophet_forecast(df, forecast_horizon, external_factors)
            confidence_level = 'high' if len(df) > 90 else 'medium'
            model_used = 'prophet'
        
        # Calculate data quality score
        data_quality_score = calculate_data_quality_score(df)
        
        # Prepare response
        response = {
            'product_id': product_id,
            'forecasts': forecast,
            'confidence_level': confidence_level,
            'model_used': model_used,
            'data_quality_score': data_quality_score,
            'external_factors_used': len(external_factors),
            'generated_at': datetime.utcnow().isoformat()
        }
        
        # Cache the result
        redis_client.setex(cache_key, CACHE_TTL, json.dumps(response))
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Error generating forecast: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/forecast/accuracy', methods=['POST'])
def calculate_forecast_accuracy():
    """Calculate forecast accuracy metrics"""
    try:
        data = request.get_json()
        
        if not data or 'forecasts' not in data or 'actual_sales' not in data:
            return jsonify({'error': 'Missing forecasts or actual_sales in request'}), 400
        
        forecasts = data['forecasts']
        actual_sales = data['actual_sales']
        
        accuracy_metrics = calculate_accuracy_metrics(forecasts, actual_sales)
        
        return jsonify({
            'accuracy_metrics': accuracy_metrics,
            'calculated_at': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error calculating accuracy: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/forecast/seasonal-analysis', methods=['POST'])
def analyze_seasonal_patterns():
    """Analyze seasonal patterns in sales data"""
    try:
        data = request.get_json()
        
        if not data or 'sales_data' not in data:
            return jsonify({'error': 'Missing sales_data in request'}), 400
        
        sales_data = data['sales_data']
        
        df = pd.DataFrame(sales_data)
        df['ds'] = pd.to_datetime(df['ds'])
        df['y'] = pd.to_numeric(df['y'], errors='coerce')
        df = df.dropna()
        
        seasonal_analysis = analyze_seasonality(df)
        
        return jsonify({
            'seasonal_analysis': seasonal_analysis,
            'analyzed_at': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error analyzing seasonality: {str(e)}")
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

def generate_enhanced_prophet_forecast(df: pd.DataFrame, days_ahead: int, external_factors: List[Dict] = None) -> List[Dict]:
    """Generate enhanced forecast using Prophet with external factors"""
    # Initialize Prophet with enhanced settings
    model = Prophet(
        daily_seasonality=True,
        weekly_seasonality=True,
        yearly_seasonality=len(df) > 365,  # Enable yearly seasonality if we have enough data
        changepoint_prior_scale=0.05,
        seasonality_prior_scale=10.0,
        holidays_prior_scale=10.0,
        interval_width=0.8
    )
    
    # Add external factors as regressors
    if external_factors:
        for factor in external_factors:
            model.add_regressor(
                factor['name'], 
                prior_scale=factor.get('prior_scale', 10.0),
                standardize=factor.get('standardize', True)
            )
    
    # Add custom seasonalities
    model.add_seasonality(name='monthly', period=30.5, fourier_order=5)
    model.add_seasonality(name='quarterly', period=91.25, fourier_order=8, condition_name='is_quarter_end')
    
    # Prepare data with external factors
    if external_factors:
        for factor in external_factors:
            df[factor['name']] = factor.get('values', [0] * len(df))
    
    # Add quarter end indicator
    df['is_quarter_end'] = df['ds'].dt.month.isin([3, 6, 9, 12])
    
    # Suppress Prophet's verbose output
    with suppress_stdout_stderr():
        model.fit(df)
    
    # Make future dataframe
    future = model.make_future_dataframe(periods=days_ahead)
    
    # Add external factors to future dataframe
    if external_factors:
        for factor in external_factors:
            future_values = factor.get('future_values', [factor.get('default_value', 0)] * days_ahead)
            current_values = factor.get('values', [0] * len(df))
            future[factor['name']] = current_values + future_values
    
    # Add quarter end indicator to future
    future['is_quarter_end'] = future['ds'].dt.month.isin([3, 6, 9, 12])
    
    # Generate forecast
    forecast = model.predict(future)
    
    # Extract relevant columns for the future dates only
    future_forecast = forecast[forecast['ds'] > df['ds'].max()][['ds', 'yhat', 'yhat_lower', 'yhat_upper']]
    
    # Format the forecast
    formatted_forecast = []
    for _, row in future_forecast.iterrows():
        formatted_forecast.append({
            'date': row['ds'].strftime('%Y-%m-%d'),
            'predicted_demand': max(0, round(row['yhat'], 2)),
            'lower_bound': max(0, round(row['yhat_lower'], 2)),
            'upper_bound': max(0, round(row['yhat_upper'], 2)),
            'confidence_interval_width': round(row['yhat_upper'] - row['yhat_lower'], 2)
        })
    
    return formatted_forecast

def generate_multi_step_forecast(df: pd.DataFrame, external_factors: List[Dict] = None) -> Dict[str, List[Dict]]:
    """Generate multi-step ahead forecasts (1, 4, 12 weeks)"""
    forecasts = {}
    
    # 1 week ahead
    forecasts['1_week'] = generate_enhanced_prophet_forecast(df, 7, external_factors)
    
    # 4 weeks ahead
    forecasts['4_week'] = generate_enhanced_prophet_forecast(df, 28, external_factors)
    
    # 12 weeks ahead
    forecasts['12_week'] = generate_enhanced_prophet_forecast(df, 84, external_factors)
    
    return forecasts

def calculate_accuracy_metrics(forecasts: List[Dict], actual_sales: List[Dict]) -> Dict[str, float]:
    """Calculate comprehensive accuracy metrics"""
    if not forecasts or not actual_sales:
        return {}
    
    # Convert to DataFrames for easier manipulation
    forecast_df = pd.DataFrame(forecasts)
    actual_df = pd.DataFrame(actual_sales)
    
    # Merge on date
    merged = pd.merge(forecast_df, actual_df, left_on='date', right_on='date', how='inner')
    
    if merged.empty:
        return {}
    
    predicted = merged['predicted_demand']
    actual = merged['actual_demand']
    
    # Calculate various accuracy metrics
    mae = np.mean(np.abs(predicted - actual))  # Mean Absolute Error
    mse = np.mean((predicted - actual) ** 2)   # Mean Squared Error
    rmse = np.sqrt(mse)                        # Root Mean Squared Error
    
    # Mean Absolute Percentage Error
    mape = np.mean(np.abs((actual - predicted) / np.where(actual != 0, actual, 1))) * 100
    
    # Mean Percentage Error (Bias)
    mpe = np.mean((actual - predicted) / np.where(actual != 0, actual, 1)) * 100
    
    # R-squared
    ss_res = np.sum((actual - predicted) ** 2)
    ss_tot = np.sum((actual - np.mean(actual)) ** 2)
    r2 = 1 - (ss_res / ss_tot) if ss_tot != 0 else 0
    
    # Accuracy percentage
    accuracy = 100 - mape if mape < 100 else 0
    
    return {
        'mae': float(mae),
        'mse': float(mse),
        'rmse': float(rmse),
        'mape': float(mape),
        'mpe': float(mpe),
        'r_squared': float(r2),
        'accuracy_percentage': float(accuracy),
        'sample_size': len(merged)
    }

def analyze_seasonality(df: pd.DataFrame) -> Dict[str, Any]:
    """Analyze seasonal patterns in the data"""
    if len(df) < 14:  # Need at least 2 weeks of data
        return {'error': 'Insufficient data for seasonality analysis'}
    
    # Add time components
    df = df.copy()
    df['day_of_week'] = df['ds'].dt.dayofweek
    df['month'] = df['ds'].dt.month
    df['quarter'] = df['ds'].dt.quarter
    
    # Weekly seasonality
    weekly_pattern = df.groupby('day_of_week')['y'].agg(['mean', 'std']).to_dict('index')
    
    # Monthly seasonality (if we have enough data)
    monthly_pattern = {}
    if len(df) >= 60:  # At least 2 months
        monthly_pattern = df.groupby('month')['y'].agg(['mean', 'std']).to_dict('index')
    
    # Quarterly seasonality (if we have enough data)
    quarterly_pattern = {}
    if len(df) >= 180:  # At least 6 months
        quarterly_pattern = df.groupby('quarter')['y'].agg(['mean', 'std']).to_dict('index')
    
    # Trend analysis
    df['ds_numeric'] = pd.to_numeric(df['ds'])
    correlation = df['ds_numeric'].corr(df['y'])
    trend = 'increasing' if correlation > 0.1 else 'decreasing' if correlation < -0.1 else 'stable'
    
    return {
        'weekly_pattern': weekly_pattern,
        'monthly_pattern': monthly_pattern,
        'quarterly_pattern': quarterly_pattern,
        'trend': trend,
        'trend_correlation': float(correlation),
        'data_points': len(df),
        'analysis_period_days': (df['ds'].max() - df['ds'].min()).days
    }

def calculate_data_quality_score(df: pd.DataFrame) -> float:
    """Calculate a data quality score from 0-100"""
    if df.empty:
        return 0.0
    
    score = 100.0
    
    # Penalize for missing data
    missing_ratio = df.isnull().sum().sum() / (len(df) * len(df.columns))
    score -= missing_ratio * 30
    
    # Penalize for insufficient data points
    if len(df) < 30:
        score -= (30 - len(df)) * 2
    
    # Penalize for zero variance
    if df['y'].var() == 0:
        score -= 40
    
    # Penalize for extreme outliers
    q75, q25 = np.percentile(df['y'], [75, 25])
    iqr = q75 - q25
    outliers = df[(df['y'] < (q25 - 1.5 * iqr)) | (df['y'] > (q75 + 1.5 * iqr))]
    outlier_ratio = len(outliers) / len(df)
    score -= outlier_ratio * 20
    
    # Reward for data recency
    days_since_last = (datetime.now().date() - df['ds'].max().date()).days
    if days_since_last <= 7:
        score += 5
    elif days_since_last > 30:
        score -= min(10, days_since_last / 10)
    
    return max(0.0, min(100.0, score))

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