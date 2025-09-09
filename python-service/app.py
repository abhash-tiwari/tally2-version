"""
Python Financial Calculation Microservice
Provides high-precision financial calculations using pandas
"""

from flask import Flask, request, jsonify
import pandas as pd
import json
import sys
from datetime import datetime
import traceback

app = Flask(__name__)

def parse_date(date_str):
    """Parse date string in DD-MMM-YY format to datetime"""
    try:
        if not date_str or pd.isna(date_str):
            return None
        
        # Handle DD-MMM-YY format (e.g., "15-Oct-23")
        if isinstance(date_str, str) and '-' in date_str:
            return pd.to_datetime(date_str, format='%d-%b-%y', errors='coerce')
        
        return pd.to_datetime(date_str, errors='coerce')
    except:
        return None

def filter_by_date_context(df, date_context):
    """Filter dataframe by date context"""
    if not date_context or not date_context.get('isDateSpecific'):
        return df
    
    # Parse dates
    df['parsed_date'] = df['date'].apply(parse_date)
    df = df.dropna(subset=['parsed_date'])
    
    # Filter by months if specified
    if date_context.get('months'):
        month_numbers = []
        month_map = {
            'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
            'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
        }
        
        for month in date_context['months']:
            if isinstance(month, str):
                month_num = month_map.get(month.lower()[:3])
                if month_num:
                    month_numbers.append(month_num)
            elif isinstance(month, int):
                month_numbers.append(month)
        
        if month_numbers:
            df = df[df['parsed_date'].dt.month.isin(month_numbers)]
    
    # Filter by years if specified
    if date_context.get('years'):
        years = []
        for year in date_context['years']:
            if isinstance(year, str):
                # Handle YY format (e.g., "23" -> 2023)
                if len(year) == 2:
                    year_num = 2000 + int(year)
                else:
                    year_num = int(year)
                years.append(year_num)
            elif isinstance(year, int):
                years.append(year)
        
        if years:
            df = df[df['parsed_date'].dt.year.isin(years)]
    
    return df

@app.route('/calculate/sales', methods=['POST'])
def calculate_sales():
    """Calculate sales totals with high precision"""
    try:
        data = request.get_json()
        sales_data = data.get('sales_data', [])
        date_context = data.get('date_context', {})
        
        if not sales_data:
            return jsonify({
                'total_amount': 0,
                'voucher_count': 0,
                'monthly_breakdown': {},
                'customer_breakdown': {},
                'date_range': 'No data'
            })
        
        # Convert to DataFrame
        df = pd.DataFrame(sales_data)
        
        # Ensure amount is numeric
        df['amount'] = pd.to_numeric(df['amount'], errors='coerce').fillna(0)
        
        # Filter by date context
        df = filter_by_date_context(df, date_context)
        
        # Calculate totals
        total_amount = df['amount'].sum()
        voucher_count = len(df)
        
        # Monthly breakdown
        df['parsed_date'] = df['date'].apply(parse_date)
        df_with_dates = df.dropna(subset=['parsed_date'])
        
        monthly_breakdown = {}
        if not df_with_dates.empty:
            monthly_group = df_with_dates.groupby(df_with_dates['parsed_date'].dt.to_period('M'))
            for period, group in monthly_group:
                month_key = str(period)
                monthly_breakdown[month_key] = {
                    'amount': float(group['amount'].sum()),
                    'count': len(group)
                }
        
        # Customer breakdown (top 10)
        customer_breakdown = {}
        if 'account' in df.columns:
            customer_group = df.groupby('account')['amount'].sum().sort_values(ascending=False).head(10)
            customer_breakdown = {str(k): float(v) for k, v in customer_group.items()}
        
        # Date range
        date_range = 'No dates'
        if not df_with_dates.empty:
            min_date = df_with_dates['parsed_date'].min()
            max_date = df_with_dates['parsed_date'].max()
            date_range = f"{min_date.strftime('%d-%b-%y')} to {max_date.strftime('%d-%b-%y')}"
        
        return jsonify({
            'total_amount': float(total_amount),
            'voucher_count': int(voucher_count),
            'monthly_breakdown': monthly_breakdown,
            'customer_breakdown': customer_breakdown,
            'date_range': date_range
        })
        
    except Exception as e:
        print(f"Error in sales calculation: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/calculate/profit', methods=['POST'])
def calculate_profit():
    """Calculate profit/loss with high precision"""
    try:
        data = request.get_json()
        revenue_data = data.get('revenue_data', [])
        expense_data = data.get('expense_data', [])
        date_context = data.get('date_context', {})
        
        # Convert to DataFrames
        revenue_df = pd.DataFrame(revenue_data) if revenue_data else pd.DataFrame()
        expense_df = pd.DataFrame(expense_data) if expense_data else pd.DataFrame()
        
        # Ensure amount columns are numeric
        if not revenue_df.empty:
            revenue_df['amount'] = pd.to_numeric(revenue_df['amount'], errors='coerce').fillna(0)
            revenue_df = filter_by_date_context(revenue_df, date_context)
        
        if not expense_df.empty:
            expense_df['amount'] = pd.to_numeric(expense_df['amount'], errors='coerce').fillna(0)
            expense_df = filter_by_date_context(expense_df, date_context)
        
        # Calculate totals
        total_revenue = revenue_df['amount'].sum() if not revenue_df.empty else 0
        total_expenses = expense_df['amount'].sum() if not expense_df.empty else 0
        net_profit = total_revenue - total_expenses
        
        # Monthly breakdown
        monthly_breakdown = {}
        
        # Combine revenue and expense data for monthly analysis
        all_data = []
        if not revenue_df.empty:
            for _, row in revenue_df.iterrows():
                all_data.append({
                    'date': row['date'],
                    'amount': row['amount'],
                    'type': 'revenue'
                })
        
        if not expense_df.empty:
            for _, row in expense_df.iterrows():
                all_data.append({
                    'date': row['date'],
                    'amount': row['amount'],
                    'type': 'expense'
                })
        
        if all_data:
            combined_df = pd.DataFrame(all_data)
            combined_df['parsed_date'] = combined_df['date'].apply(parse_date)
            combined_df = combined_df.dropna(subset=['parsed_date'])
            
            if not combined_df.empty:
                monthly_group = combined_df.groupby([
                    combined_df['parsed_date'].dt.to_period('M'),
                    'type'
                ])['amount'].sum().unstack(fill_value=0)
                
                for period in monthly_group.index:
                    month_key = str(period)
                    month_revenue = monthly_group.loc[period].get('revenue', 0)
                    month_expense = monthly_group.loc[period].get('expense', 0)
                    monthly_breakdown[month_key] = {
                        'revenue': float(month_revenue),
                        'expense': float(month_expense),
                        'profit': float(month_revenue - month_expense)
                    }
        
        return jsonify({
            'total_revenue': float(total_revenue),
            'total_expenses': float(total_expenses),
            'net_profit': float(net_profit),
            'monthly_breakdown': monthly_breakdown,
            'revenue_entries': len(revenue_df),
            'expense_entries': len(expense_df)
        })
        
    except Exception as e:
        print(f"Error in profit calculation: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'python-financial-calculator',
        'pandas_version': pd.__version__
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
