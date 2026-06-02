const mqtt = require('mqtt');
const express = require('express'); 
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const { SerialPort } = require('serialport'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

mongoose.connect('mongodb://localhost:27017/iot_mesh_db')
    .then(async () => {
        console.log(">>> Đã kết nối MongoDB thành công!"); 
    })
    .catch(err => console.error("Lỗi kết nối MongoDB:", err));

// Lược đồ lịch sử dữ liệu cảm biến 
const SensorSchema = new mongoose.Schema({
    node_id: String,      
    temp: Number,         
    humi: Number,         
    lux: Number,          
    motion: Number,       
    timestamp: { type: Date, default: Date.now }
});
const Sensor = mongoose.model('Sensor', SensorSchema); 

// Lược đồ danh bạ cấu hình của từng khách hàng / từng nhà kho
const WarehouseConfigSchema = new mongoose.Schema({
    node_id: { type: String, unique: true }, 
    owner_name: String,                      
    phone_number: String,                    
    temp_max: Number,                        
    humi_max: Number,                        
    light_max: Number                        
});
const WarehouseConfig = mongoose.model('WarehouseConfig', WarehouseConfigSchema);

const serialPortPath = 'COM5'; 

const simPort = new SerialPort({
    path: serialPortPath,
    baudRate: 115200,
    autoOpen: true
});

simPort.on('open', () => {
    console.log(`>>> [SIM 4G] Đã kết nối thành công với module SIM tại cổng ${serialPortPath}`);
    // Chuỗi AT khởi động tối ưu cho module SIM A7680C
    setTimeout(() => simPort.write("AT+VOLTE=1\r\n"), 700);  // Kích hoạt VoLTE để gọi điện trên băng tần 4G
    setTimeout(() => simPort.write("AT+CTZU=1\r\n"), 1200);  // Tự động cập nhật thời gian từ trạm viễn thông
});

simPort.on('error', (err) => {
    console.error('[SIM 4G LỖI Phần cứng]:', err.message);
});

// Hàm điều khiển SIM gọi điện và nhắn tin theo thông số ĐỘNG truyền vào
function send_4g_alert_from_laptop(msg, target_phone) {
    console.log(`[KÍCH HOẠT SIM 4G] Đang thực hiện cuộc gọi khẩn cấp tới: ${target_phone}`);
    
    // Ra lệnh gọi điện đổ chuông khẩn cấp
    simPort.write(`ATD${target_phone};\r\n`);
    
    // Đổ chuông đúng 10 giây rồi chủ động gác máy để chuyển sang gửi SMS chi tiết
    setTimeout(() => {
        simPort.write("ATH\r\n");
        console.log(`[SIM 4G] Đã gác máy số ${target_phone}, tiến hành gửi tin nhắn SMS...`);
        
        setTimeout(() => {
            simPort.write("AT+CMGF=1\r\n"); // Chuyển sang Text Mode để viết ký tự thông thường
            setTimeout(() => {
                simPort.write(`AT+CMGS="${target_phone}"\r\n`);
                setTimeout(() => {
                    simPort.write(msg); // Viết nội dung tin nhắn không dấu
                    setTimeout(() => {
                        simPort.write("\x1A"); // Gửi mã Ctrl+Z (0x1A) để ra lệnh phát tin đi
                        console.log(`[SIM 4G] Đã phát tin nhắn SMS tới số ${target_phone} thành công!`);
                    }, 500);
                }, 500);
            }, 500);
        }, 1500);

    }, 10000);
}

let alerting_status = {}; 


const mqttClient = mqtt.connect('mqtt://172.20.10.2:1883');
//const mqttClient = mqtt.connect('mqtt://192.168.1.9:1883');

app.use(express.static('public'));

mqttClient.on('connect', () => {
    console.log(">>> Đã kết nối MQTT Broker thành công!");
    mqttClient.subscribe('warehouse/sensors/data'); // Đăng ký luồng dữ liệu cảm biến
    mqttClient.subscribe('warehouse/mesh/status');  // Đăng ký luồng trạng thái vá lỗi Self-Healing
});

mqttClient.on('message', async (topic, message) => {
    try {
        const data = JSON.parse(message.toString());

        //Nhận luồng dữ liệu trắc quan từ các cảm biến gửi về
        if (topic === 'warehouse/sensors/data') {
            if (!data.node_id) return;

            // Đồng bộ định danh biến ánh sáng từ các phiên bản code cũ
            data.lux = data.lux !== undefined ? data.lux : (data.light_v || data.light || 0);
            console.log(`[Dữ liệu từ ${data.node_id}]: T=${data.temp}°C, H=${data.humi}%, L=${data.lux} Lux`);
            
            // Phát tín hiệu Real-time cập nhật biểu đồ động trên giao diện Web Dashboard
            io.emit('updateData', data);
            
            // Lưu trữ bản ghi lịch sử vào MongoDB
            const newRecord = new Sensor({
                node_id: data.node_id,
                temp: data.temp,
                humi: data.humi,
                lux: data.lux,
                motion: data.motion
            });
            await newRecord.save();

            // TỰ ĐỘNG LỤC DATABASE ĐỂ TÌM NGƯỠNG AN TOÀN VÀ DANH BẠ THEO NODE_ID ĐANG GỬI TIN
            const config = await WarehouseConfig.findOne({ node_id: data.node_id });
            
            if (config) {
                let t = data.temp || 0;
                let h = data.humi || 0;
                let l = data.lux || 0;

                // Tiến hành so sánh dữ liệu thực tế với ngưỡng riêng được cài đặt trong DB của kho đó
                let fail = (t > config.temp_max || h > config.humi_max || l > config.light_max);

                // Nếu nút này lần đầu gửi tin, khởi tạo cờ báo động mặc định là false
                if (alerting_status[data.node_id] === undefined) {
                    alerting_status[data.node_id] = false;
                }

                // Kịch bản chuyển trạng thái: Từ Bình thường -> Vượt ngưỡng báo động
                if (fail && !alerting_status[data.node_id]) {
                    const alertMsg = `CANH BAO: Thiet bi ${data.node_id} tai kho cua ${config.owner_name} bat thuong! Thong so thuc te: T:${t}C, H:${h}%, L:${l}Lx.`;
                    
                    // Gọi hàm SIM truyền trực tiếp nội dung và số điện thoại động của chủ kho lấy từ DB
                    send_4g_alert_from_laptop(alertMsg, config.phone_number);
                    
                    io.emit('mesh_alert', { 
                        status: 'ALERT', 
                        msg: `⚠️ BÁO ĐỘNG: Thiết bị ${data.node_id} vượt ngưỡng! Đang gọi điện khẩn cấp tới chủ kho: ${config.owner_name} (${config.phone_number})...` 
                    });
                    alerting_status[data.node_id] = true;

                // Kịch bản phục hồi: Từ Báo động -> Trở lại an toàn dưới ngưỡng
                } else if (!fail && alerting_status[data.node_id]) {
                    io.emit('mesh_alert', { 
                        status: 'OK', 
                        msg: `✅ Hệ thống an toàn: Thiết bị ${data.node_id} của khách hàng ${config.owner_name} đã trở lại mức bình thường.` 
                    });
                    alerting_status[data.node_id] = false;
                }
            }
        } 
        

        else if (topic === 'warehouse/mesh/status') {
            console.log(`[Trạng thái cấu trúc mạng MESH]: ${data.msg}`);
            io.emit('mesh_alert', data);
        }

    } catch (e) {
        console.log("Lỗi định dạng cấu trúc JSON nhận được từ mạng Mesh.");
    }
});

io.on('connection', (socket) => {
    socket.on('set_threshold', async (vals) => {
        try {
            // Giao diện web mặc định demo cho nút Leaf_01
            const targetNode = vals.node_id || 'Leaf_01'; 

            // Cập nhật vĩnh viễn mốc cấu hình ngưỡng mới này vào MongoDB của nút tương ứng
            await WarehouseConfig.findOneAndUpdate(
                { node_id: targetNode },
                {
                    temp_max: parseFloat(vals.temp),
                    humi_max: parseFloat(vals.humi),
                    light_max: parseFloat(vals.light)
                },
                { upsert: true }
            );

            // Giải phóng cờ báo động để ép hệ thống thực hiện đo đạc so sánh mốc cấu hình mới ngay lập tức
            alerting_status[targetNode] = false; 

            console.log(`>>> [MỌI THỨ ĐÃ LƯU VÀO DB] Cập nhật ngưỡng mới cho nút ${targetNode}: T:${vals.temp}, H:${vals.humi}, L:${vals.light}`);
            

        } catch (err) {
            console.error("Lỗi đồng bộ cập nhật cấu hình vào Database:", err);
        }
    });
});

// Khởi chạy Máy chủ trung tâm Laptop
server.listen(3000, () => {
    console.log("Server Dashboard hoạt động tại: http://localhost:3000");
});