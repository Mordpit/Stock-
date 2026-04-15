from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import yfinance as yf
import json
import os
import requests as http_requests
from datetime import datetime, timedelta, timezone
import pytz

app = Flask(__name__, static_folder='.')
CORS(app)

STOCKS_FILE = 'stocks.json'
TELEGRAM_CONFIG_FILE = 'telegram_config.json'

# Cache สำหรับราคาหุ้น (เก็บไว้ 1 นาที)
price_cache = {}
CACHE_DURATION = 60  # 1 นาที

def load_telegram_config():
    """โหลดการตั้งค่า Telegram จากไฟล์"""
    if os.path.exists(TELEGRAM_CONFIG_FILE):
        with open(TELEGRAM_CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"bot_token": "", "chat_id": ""}

def save_telegram_config(config):
    """บันทึกการตั้งค่า Telegram ลงไฟล์"""
    with open(TELEGRAM_CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

def send_telegram_message(bot_token, chat_id, text):
    """ส่งข้อความผ่าน Telegram Bot API"""
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    response = http_requests.post(url, json=payload, timeout=10)
    return response.json()

def load_stocks():
    """โหลดข้อมูลหุ้นจากไฟล์ JSON"""
    if os.path.exists(STOCKS_FILE):
        with open(STOCKS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"stocks": []}

def save_stocks(data):
    """บันทึกข้อมูลหุ้นลงไฟล์ JSON"""
    with open(STOCKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

@app.route('/')
def index():
    """แสดงหน้าหลัก"""
    return send_from_directory('.', 'index.html')

@app.route('/style.css')
def serve_css():
    """ส่งไฟล์ CSS"""
    return send_from_directory('.', 'style.css')

@app.route('/app.js')
def serve_js():
    """ส่งไฟล์ JavaScript"""
    return send_from_directory('.', 'app.js')

def get_stock_price(symbol):
    """ดึงราคาหุ้นพร้อม cache"""
    now = datetime.now()
    
    # ตรวจสอบ cache
    if symbol in price_cache:
        cached_price, cached_time = price_cache[symbol]
        if (now - cached_time).total_seconds() < CACHE_DURATION:
            print(f"📦 Using cached price for {symbol}: ${cached_price}")
            return cached_price
    
    # ดึงราคาใหม่ (ใช้วิธีเดียวที่น่าเชื่อถือที่สุด)
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1d")
        if not hist.empty and 'Close' in hist.columns:
            current_price = float(hist['Close'].iloc[-1])
            price_cache[symbol] = (current_price, now)
            print(f"✓ Fetched fresh price for {symbol}: ${current_price}")
            return current_price
    except Exception as e:
        print(f"✗ Error fetching {symbol}: {e}")
    
    return None

def get_price_change_percent(symbol, period='1wk'):
    """คำนวณเปอร์เซ็นต์การเปลี่ยนแปลงตามช่วงเวลาที่กำหนด"""
    try:
        ticker = yf.Ticker(symbol)
        
        # กรณี 1d: ดึง 5 วันแล้วเปรียบเทียบ 2 วันสุดท้าย
        if period == '1d':
            hist = ticker.history(period='5d')
            
            if hist.empty or len(hist) < 2:
                return None
            
            weekday_mask = hist.index.dayofweek < 5
            hist_filtered = hist[weekday_mask]
            
            if len(hist_filtered) < 2:
                return None
            
            previous_price = float(hist_filtered['Close'].iloc[-2])
            current_price = float(hist_filtered['Close'].iloc[-1])
            
            if previous_price == 0:
                return None
            
            change_percent = ((current_price - previous_price) / previous_price) * 100
            return round(change_percent, 2)
        
        # กรณีอื่นๆ: เปรียบเทียบราคาแรกกับราคาล่าสุดในช่วงเวลา
        hist = ticker.history(period=period)
        
        if hist.empty or len(hist) < 2:
            return None
        
        # กรองเฉพาะวันทำการ (จันทร์-ศุกร์)
        weekday_mask = hist.index.dayofweek < 5
        hist_filtered = hist[weekday_mask]
        
        if len(hist_filtered) < 2:
            return None
        
        # ราคาแรกและราคาล่าสุดในช่วงเวลา
        first_price = float(hist_filtered['Close'].iloc[0])
        current_price = float(hist_filtered['Close'].iloc[-1])
        
        if first_price == 0:
            return None
        
        # คำนวณเปอร์เซ็นต์การเปลี่ยนแปลง
        change_percent = ((current_price - first_price) / first_price) * 100
        
        return round(change_percent, 2)
    except Exception as e:
        print(f"✗ Error calculating price change for {symbol}: {e}")
        return None

@app.route('/api/stocks', methods=['GET'])
def get_stocks():
    """ดึงข้อมูลหุ้นทั้งหมดพร้อมราคาปัจจุบัน"""
    try:
        data = load_stocks()
        stocks_with_prices = []
        
        for stock in data['stocks']:
            try:
                symbol = stock['symbol']
                current_price = get_stock_price(symbol)
                change_percent = get_price_change_percent(symbol)
                
                target_sell = stock.get('target_sell', 0)
                
                if current_price is None or current_price == 0:
                    stock_info = {
                        "symbol": symbol,
                        "name": stock['name'],
                        "target": stock['target'],
                        "target_sell": target_sell,
                        "current": 0,
                        "reached": False,
                        "reached_sell": False,
                        "change_percent": None,
                        "error": "ไม่สามารถดึงราคาได้ในขณะนี้"
                    }
                else:
                    # ดึงข้อมูล sector และ industry
                    try:
                        ticker = yf.Ticker(symbol)
                        info = ticker.info
                        sector = info.get('sector', 'Other')
                        industry = info.get('industry', 'General')
                    except:
                        sector = 'Other'
                        industry = 'General'
                    
                    stock_info = {
                        "symbol": symbol,
                        "name": stock['name'],
                        "target": stock.get('target', 0),
                        "target_sell": stock.get('target_sell', 0),
                        "current": round(current_price, 2),
                        "sector": sector,
                        "industry": industry,
                        "reached": current_price <= stock.get('target', 0) if stock.get('target', 0) > 0 else False,
                        "reached_sell": target_sell > 0 and current_price >= target_sell,
                        "change_percent": change_percent
                    }
                
                stocks_with_prices.append(stock_info)
                
            except Exception as e:
                print(f"Error processing {stock.get('symbol', 'UNKNOWN')}: {str(e)}")
                stock_info = {
                    "symbol": stock.get('symbol', 'UNKNOWN'),
                    "name": stock.get('name', 'Unknown'),
                    "target": stock.get('target', 0),
                    "target_sell": stock.get('target_sell', 0),
                    "current": 0,
                    "reached": False,
                    "reached_sell": False,
                    "error": f"เกิดข้อผิดพลาด"
                }
                stocks_with_prices.append(stock_info)
        
        return jsonify({"stocks": stocks_with_prices})
    except Exception as e:
        print(f"Error in get_stocks: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/stocks', methods=['POST'])
def add_stock():
    """เพิ่มหุ้นใหม่"""
    try:
        new_stock = request.json
        symbol = new_stock.get('symbol', '').upper()
        target = float(new_stock.get('target', 0))
        target_sell = float(new_stock.get('target_sell', 0))
        
        if not symbol or target <= 0:
            return jsonify({"error": "กรุณากรอกข้อมูลให้ครบถ้วน"}), 400
        
        # ตรวจสอบว่า symbol เป็นตัวอักษรเท่านั้น
        if not symbol.replace('.', '').replace('-', '').isalnum():
            return jsonify({"error": "สัญลักษณ์หุ้นไม่ถูกต้อง"}), 400
        
        data = load_stocks()
        
        # ตรวจสอบว่ามีหุ้นนี้แล้วหรือไม่
        for stock in data['stocks']:
            if stock['symbol'] == symbol:
                return jsonify({"error": "มีหุ้นนี้อยู่แล้ว"}), 400
        
        # ลองดึงชื่อจาก yfinance แต่ไม่จำเป็นต้องสำเร็จ
        name = symbol
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            name = info.get('longName') or info.get('shortName', symbol)
        except:
            pass  # ใช้ symbol เป็นชื่อถ้าดึงไม่ได้
        
        data['stocks'].append({
            "symbol": symbol,
            "target": target,
            "target_sell": target_sell,
            "name": name
        })
        
        save_stocks(data)
        return jsonify({"message": "เพิ่มหุ้นสำเร็จ", "stock": {"symbol": symbol, "target": target, "target_sell": target_sell, "name": name}}), 201
    except Exception as e:
        print(f"Error in add_stock: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/stocks/<symbol>', methods=['PUT'])
def update_stock(symbol):
    """อัพเดทราคาเข้าซื้อของหุ้น"""
    try:
        symbol = symbol.upper()
        new_target = float(request.json.get('target', 0))
        new_target_sell = request.json.get('target_sell')
        
        data = load_stocks()
        found = False
        
        for stock in data['stocks']:
            if stock['symbol'] == symbol:
                if new_target > 0:
                    stock['target'] = new_target
                if new_target_sell is not None:
                    stock['target_sell'] = float(new_target_sell)
                found = True
                break
        
        if not found:
            return jsonify({"error": "ไม่พบหุ้นนี้"}), 404
        
        save_stocks(data)
        return jsonify({"message": "อัพเดทสำเร็จ"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/stocks/<symbol>', methods=['DELETE'])
def delete_stock(symbol):
    """ลบหุ้น"""
    try:
        symbol = symbol.upper()
        data = load_stocks()
        
        original_length = len(data['stocks'])
        data['stocks'] = [s for s in data['stocks'] if s['symbol'] != symbol]
        
        if len(data['stocks']) == original_length:
            return jsonify({"error": "ไม่พบหุ้นนี้"}), 404
        
        save_stocks(data)
        return jsonify({"message": "ลบสำเร็จ"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/price/<symbol>', methods=['GET'])
def get_price(symbol):
    """ดึงราคาปัจจุบันของหุ้น"""
    try:
        symbol = symbol.upper()
        current_price = None
        
        # ลองหลายวิธีเหมือนใน get_stocks
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="5d")
            if not hist.empty and 'Close' in hist.columns:
                current_price = float(hist['Close'].iloc[-1])
        except:
            pass
        
        if current_price is None:
            try:
                ticker = yf.Ticker(symbol)
                current_price = float(ticker.fast_info.get('lastPrice', 0))
                if current_price == 0:
                    current_price = None
            except:
                pass
        
        if current_price is None:
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.info
                current_price = float(info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose', 0))
                if current_price == 0:
                    current_price = None
            except:
                pass
        
        if current_price is None or current_price == 0:
            return jsonify({"error": "ไม่สามารถดึงราคาได้"}), 404
        
        return jsonify({
            "symbol": symbol,
            "price": round(current_price, 2)
        })
    except Exception as e:
        print(f"Error in get_price: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/history/<symbol>', methods=['GET'])
def get_history(symbol):
    """ดึงข้อมูลราคาย้อนหลังสำหรับกราฟ"""
    try:
        symbol = symbol.upper()
        period = request.args.get('period', '1mo')  # ค่าเริ่มต้น 1 เดือน
        
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period)
        
        if hist.empty:
            return jsonify({"error": "ไม่พบข้อมูลราคาย้อนหลัง"}), 404
        
        if period == '1d':
            # ข้อมูล intraday: ดึง 1 วันแบบ 5 นาที เพื่อแสดงการผันผวนภายในวัน
            hist = ticker.history(period='1d', interval='5m')
            
            if hist.empty:
                # ถ้าไม่มีข้อมูลวันนี้ ลองดึงย้อนหลัง 5 วันเพื่อเอาวันทำการล่าสุด
                hist = ticker.history(period='5d', interval='5m')
                if hist.empty:
                    return jsonify({"error": "ไม่พบข้อมูลราคาย้อนหลัง"}), 404
                # เอาเฉพาะวันสุดท้าย
                last_date = hist.index[-1].date()
                hist = hist[hist.index.date == last_date]
            
            # แปลงเวลาเป็นเวลาประเทศไทย (UTC+7)
            thai_tz = pytz.timezone('Asia/Bangkok')
            dates = [date.astimezone(thai_tz).strftime('%H:%M') for date in hist.index]
            prices = [round(float(price), 2) for price in hist['Close']]
        else:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period=period)
            
            if hist.empty:
                return jsonify({"error": "ไม่พบข้อมูลราคาย้อนหลัง"}), 404
            
            # กรองเฉพาะวันจันทร์-ศุกร์ (0=Monday, 4=Friday)
            weekday_mask = hist.index.dayofweek < 5
            hist_filtered = hist[weekday_mask]
            
            # แปลงข้อมูลเป็น format ที่ Chart.js ใช้ได้
            dates = [date.strftime('%Y-%m-%d') for date in hist_filtered.index]
            prices = [round(float(price), 2) for price in hist_filtered['Close']]
        
        return jsonify({
            "symbol": symbol,
            "dates": dates,
            "prices": prices
        })
    except Exception as e:
        print(f"Error in get_history: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/change/<symbol>', methods=['GET'])
def get_change_percent(symbol):
    """ดึงเปอร์เซ็นต์การเปลี่ยนแปลงตามช่วงเวลา"""
    try:
        symbol = symbol.upper()
        period = request.args.get('period', '1wk')  # ค่าเริ่มต้น 1 สัปดาห์
        
        change_percent = get_price_change_percent(symbol, period)
        
        if change_percent is None:
            return jsonify({"error": "ไม่สามารถคำนวณการเปลี่ยนแปลงได้"}), 404
        
        return jsonify({
            "symbol": symbol,
            "period": period,
            "change_percent": change_percent
        })
    except Exception as e:
        print(f"Error in get_change_percent: {str(e)}")
        return jsonify({"error": str(e)}), 500

def get_exchange_rates():
    """ดึงอัตราแลกเปลี่ยนล่าสุด"""
    rates = {}
    try:
        # ดึงข้อมูลจาก Yahoo Finance
        # THB=X คือ USD/THB
        # JPY=X คือ USD/JPY -> JPY/THB = (USD/THB) / (USD/JPY)
        # CNY=X คือ USD/CNY -> CNY/THB = (USD/THB) / (USD/CNY)
        tickers = ['THB=X', 'JPY=X', 'CNY=X']
        data = yf.download(tickers, period='5d', interval='1d', progress=False)
        
        if not data.empty and 'Close' in data.columns:
            # ดึงราคาปิดล่าสุด
            # yfinance อาจจะ return MultiIndex หรือ SingleIndex ขึ้นอยู่กับ input
            try:
                # กรณี MultiIndex (download หลายตัว)
                close_data = data['Close']
                usd_thb = float(close_data['THB=X'].iloc[-1])
                usd_jpy = float(close_data['JPY=X'].iloc[-1])
                usd_cny = float(close_data['CNY=X'].iloc[-1])

                # ราคาปิดวันก่อนหน้า
                prev_usd_thb = float(close_data['THB=X'].iloc[-2])
                prev_usd_jpy = float(close_data['JPY=X'].iloc[-2])
                prev_usd_cny = float(close_data['CNY=X'].iloc[-2])
                
            except KeyError:
                 # Fallback ถ้าโครงสร้างข้อมูลไม่ตรง
                 return None

            # คำนวณ (USD/THB)
            rates['USD'] = {
                'rate': round(usd_thb, 2),
                'change': round(((usd_thb - prev_usd_thb) / prev_usd_thb) * 100, 2)
            }

            # คำนวณ (JPY/THB) * 100 เยน
            jpy_thb = (usd_thb / usd_jpy) * 100
            prev_jpy_thb = (prev_usd_thb / prev_usd_jpy) * 100
            rates['JPY'] = {
                'rate': round(jpy_thb, 2),
                'change': round(((jpy_thb - prev_jpy_thb) / prev_jpy_thb) * 100, 2)
            }

            # คำนวณ (CNY/THB)
            cny_thb = usd_thb / usd_cny
            prev_cny_thb = prev_usd_thb / prev_usd_cny
            rates['CNY'] = {
                'rate': round(cny_thb, 2),
                'change': round(((cny_thb - prev_cny_thb) / prev_cny_thb) * 100, 2)
            }
            
            return rates
            
    except Exception as e:
        print(f"Error fetching rates: {e}")
        return None
    return None

@app.route('/api/rates')
def get_rates():
    """API สำหรับดึงอัตราแลกเปลี่ยน"""
    rates = get_exchange_rates()
    if rates:
        return jsonify(rates)
    return jsonify({"error": "Unable to fetch rates"}), 500

# === Telegram Notification Endpoints ===

@app.route('/api/telegram/config', methods=['GET'])
def get_telegram_config():
    """ดึงการตั้งค่า Telegram (ซ่อน token บางส่วน)"""
    config = load_telegram_config()
    # ซ่อน token เพื่อความปลอดภัย
    token = config.get('bot_token', '')
    masked_token = token[:6] + '...' + token[-4:] if len(token) > 10 else ('ยังไม่ได้ตั้งค่า' if not token else token)
    return jsonify({
        "has_token": bool(token),
        "masked_token": masked_token,
        "chat_id": config.get('chat_id', '')
    })

@app.route('/api/telegram/config', methods=['POST'])
def save_telegram_config_api():
    """บันทึกการตั้งค่า Telegram"""
    try:
        data = request.json
        bot_token = data.get('bot_token', '').strip()
        chat_id = str(data.get('chat_id', '')).strip()

        if not bot_token or not chat_id:
            return jsonify({"error": "กรุณากรอก Bot Token และ Chat ID"}), 400

        save_telegram_config({"bot_token": bot_token, "chat_id": chat_id})
        return jsonify({"message": "บันทึกการตั้งค่าสำเร็จ"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/telegram/test', methods=['POST'])
def test_telegram():
    """ส่งข้อความทดสอบ Telegram"""
    try:
        config = load_telegram_config()
        bot_token = config.get('bot_token', '')
        chat_id = config.get('chat_id', '')

        if not bot_token or not chat_id:
            return jsonify({"error": "ยังไม่ได้ตั้งค่า Bot Token หรือ Chat ID"}), 400

        text = (
            "✅ <b>ทดสอบการแจ้งเตือน Stock Tracker</b>\n\n"
            "🎉 การเชื่อมต่อ Telegram Bot สำเร็จ!\n"
            "คุณจะได้รับการแจ้งเตือนเมื่อหุ้นถึงราคาเป้าหมาย"
        )
        result = send_telegram_message(bot_token, chat_id, text)

        if result.get('ok'):
            return jsonify({"message": "ส่งข้อความทดสอบสำเร็จ!"})
        else:
            return jsonify({"error": f"Telegram Error: {result.get('description', 'Unknown error')}"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/telegram/notify', methods=['POST'])
def telegram_notify():
    """ส่งการแจ้งเตือนราคาหุ้นผ่าน Telegram"""
    try:
        config = load_telegram_config()
        bot_token = config.get('bot_token', '')
        chat_id = config.get('chat_id', '')

        if not bot_token or not chat_id:
            return jsonify({"error": "ยังไม่ได้ตั้งค่า Telegram"}), 400

        data = request.json
        symbol = data.get('symbol', '')
        name = data.get('name', symbol)
        current = data.get('current', 0)
        target = data.get('target', 0)
        notify_type = data.get('type', 'buy')  # 'buy' หรือ 'sell'

        if notify_type == 'buy':
            text = (
                f"🚨 <b>ถึงราคาเข้าซื้อแล้ว!</b>\n\n"
                f"📊 <b>{symbol}</b> ({name})\n"
                f"💰 ราคาปัจจุบัน: <b>${current:.2f}</b>\n"
                f"🎯 ราคาเข้าซื้อ: <b>${target:.2f}</b>\n\n"
                f"⏰ {datetime.now(pytz.timezone('Asia/Bangkok')).strftime('%d/%m/%Y %H:%M')} (BKK)"
            )
        else:
            text = (
                f"🎯 <b>ถึงราคาเป้าหมายแล้ว!</b>\n\n"
                f"📊 <b>{symbol}</b> ({name})\n"
                f"💰 ราคาปัจจุบัน: <b>${current:.2f}</b>\n"
                f"📈 ราคาเป้าหมาย: <b>${target:.2f}</b>\n\n"
                f"⏰ {datetime.now(pytz.timezone('Asia/Bangkok')).strftime('%d/%m/%Y %H:%M')} (BKK)"
            )

        result = send_telegram_message(bot_token, chat_id, text)

        if result.get('ok'):
            return jsonify({"message": "ส่งแจ้งเตือนสำเร็จ"})
        else:
            return jsonify({"error": f"Telegram Error: {result.get('description', 'Unknown error')}"}), 400
    except Exception as e:
        print(f"Error sending Telegram notification: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
