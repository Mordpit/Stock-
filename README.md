# 📈 ระบบติดตามราคาเป้าหมายหุ้น

เว็บแอปพลิเคชันสำหรับติดตามราคาหุ้นและแจ้งเตือนเมื่อราคาถึงเป้าหมาย โดยใช้ yfinance สำหรับดึงข้อมูลราคาแบบเรียลไทม์

## ✨ ฟีเจอร์

- 📊 แสดงราคาหุ้นแบบเรียลไทม์
- 🎯 กำหนดราคาเป้าหมายสำหรับแต่ละหุ้น
- 🚨 แจ้งเตือนเมื่อราคาถึงเป้าหมาย
- 🔄 อัพเดทราคาอัตโนมัติทุก 30 วินาที
- ➕ เพิ่ม/แก้ไข/ลบหุ้นได้ง่ายๆ
- 💎 ดีไซน์สวยงามแบบ Dark Mode
- 📱 รองรับการใช้งานบนมือถือ

## 🚀 การติดตั้ง

### 1. ติดตั้ง Python Dependencies

```bash
pip install -r requirements.txt
```

หรือติดตั้งแยกแต่ละตัว:

```bash
pip install flask flask-cors yfinance requests
```

### 2. รันเซิร์ฟเวอร์ Flask

```bash
python app.py
```

เซิร์ฟเวอร์จะเริ่มทำงานที่ `http://localhost:5000`

### 3. เปิดเว็บในเบราว์เซอร์

เปิดเบราว์เซอร์และไปที่:
```
http://localhost:5000
```

## 📖 การใช้งาน

### เพิ่มหุ้นใหม่

1. กรอกสัญลักษณ์หุ้น (เช่น AAPL, GOOGL, MSFT)
2. กรอกราคาเป้าหมายที่ต้องการ
3. กดปุ่ม "เพิ่มหุ้น"

### แก้ไขราคาเป้าหมาย

1. กดปุ่ม "✏️ แก้ไข" ในการ์ดหุ้น
2. กรอกราคาเป้าหมายใหม่
3. กด OK เพื่อบันทึก

### ลบหุ้น

1. กดปุ่ม "🗑️ ลบ" ในการ์ดหุ้น
2. ยืนยันการลบ

### การแจ้งเตือน

เมื่อราคาหุ้นถึงหรือเกินราคาเป้าหมาย:
- การ์ดหุ้นจะแสดงป้าย "🚨 ถึงเป้าแล้ว!"
- สีของการ์ดจะเปลี่ยนเป็นสีเขียว
- แถบด้านบนการ์ดจะกระพริบ

## 🔌 API Endpoints

### GET `/api/stocks`
ดึงข้อมูลหุ้นทั้งหมดพร้อมราคาปัจจุบัน

**Response:**
```json
{
  "stocks": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "target": 150,
      "current": 175.50,
      "reached": true
    }
  ]
}
```

### POST `/api/stocks`
เพิ่มหุ้นใหม่

**Request Body:**
```json
{
  "symbol": "AAPL",
  "target": 150
}
```

### PUT `/api/stocks/<symbol>`
อัพเดทราคาเป้าหมาย

**Request Body:**
```json
{
  "target": 160
}
```

### DELETE `/api/stocks/<symbol>`
ลบหุ้น

### GET `/api/price/<symbol>`
ดึงราคาปัจจุบันของหุ้น

## 🎨 เทคโนโลยีที่ใช้

- **Backend:** Flask (Python)
- **Frontend:** HTML, CSS, JavaScript
- **Stock Data:** yfinance
- **Data Storage:** JSON
- **Styling:** Custom CSS with Glassmorphism

## 📁 โครงสร้างไฟล์

```
stock/
├── app.py              # Flask backend server
├── stocks.json         # ข้อมูลหุ้นที่ติดตาม
├── requirements.txt    # Python dependencies
├── index.html          # หน้าหลักของเว็บ
├── style.css           # สไตล์และธีม
├── app.js              # Frontend logic
└── README.md           # เอกสารนี้
```

## 🔧 การปรับแต่ง

### เปลี่ยนช่วงเวลาอัพเดทอัตโนมัติ

แก้ไขในไฟล์ `app.js`:
```javascript
const REFRESH_INTERVAL = 30000; // เปลี่ยนเป็นมิลลิวินาทีที่ต้องการ
```

### เปลี่ยนสี/ธีม

แก้ไขค่า CSS variables ในไฟล์ `style.css`:
```css
:root {
  --primary-bg: #0a0e27;
  --accent-1: #6366f1;
  /* ... */
}
```

## ⚠️ หมายเหตุ

- ต้องมีการเชื่อมต่ออินเทอร์เน็ตเพื่อดึงข้อมูลราคาหุ้น
- API ของ yfinance อาจมีข้อจำกัดในการเรียกใช้งาน หากเรียกบ่อยเกินไปอาจถูกบล็อก
- ข้อมูลราคามีความล่าช้าเล็กน้อยจากตลาดจริง
- รองรับหุ้นต่างประเทศที่มีข้อมูลใน Yahoo Finance

## 📝 ตัวอย่างหุ้นที่สามารถติดตามได้

- **หุ้นสหรัฐฯ:** AAPL, GOOGL, MSFT, TSLA, AMZN, META, NVDA
- **หุ้นไทย:** PTT.BK, KBANK.BK, AOT.BK, CPALL.BK
- **Crypto:** BTC-USD, ETH-USD

## 🤝 การสนับสนุน

หากพบปัญหาหรือมีข้อเสนอแนะ สามารถแจ้งได้ทันที!

---

สร้างด้วย ❤️ โดยใช้ Python + Flask + yfinance
# Stock-
# Stock-
# Stock-
