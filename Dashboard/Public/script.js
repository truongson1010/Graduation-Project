const socket = io();
const nodesUI = {}; 

// Hàm tạo giao diện động cho Node mới
function createNodeUI(nodeId) {
    const container = document.getElementById('nodes-container');
    
    const section = document.createElement('div');
    section.className = 'node-section';
    section.innerHTML = `
        <div class="node-header">
            <h2 style="margin:0">📍 Thiết bị: ${nodeId}</h2>
            <span id="time-${nodeId}" style="color:#95a5a6; font-size:0.9em">Đang đợi...</span>
        </div>
        <div class="grid">
            <div class="card"><h3>Nhiệt độ</h3><p id="temp-${nodeId}">--</p>°C</div>
            <div class="card"><h3>Độ ẩm</h3><p id="humi-${nodeId}">--</p>%</div>
            <div class="card"><h3>Ánh sáng</h3><p id="light-${nodeId}">--</p>Lx</div>
            <div class="card"><h3>Chuyển động</h3><p id="motion-${nodeId}">--</p></div>
        </div>
        <div class="charts-grid">
            <div class="chart-box"><canvas id="chart-temp-${nodeId}"></canvas></div>
            <div class="chart-box"><canvas id="chart-humi-${nodeId}"></canvas></div>
            <div class="chart-box"><canvas id="chart-light-${nodeId}"></canvas></div>
        </div>
    `;
    container.appendChild(section);

    // Khởi tạo biểu đồ cho Node 
    nodesUI[nodeId] = {
        temp: new Chart(document.getElementById(`chart-temp-${nodeId}`), createChartConfig('Nhiệt độ', '#ff6384', 20, 50)),
        humi: new Chart(document.getElementById(`chart-humi-${nodeId}`), createChartConfig('Độ ẩm', '#36a2eb', 0, 100)),
        light: new Chart(document.getElementById(`chart-light-${nodeId}`), createChartConfig('Ánh sáng (Lux)', '#ffce56', 0, 1000))
    };
}

// Nhận dữ liệu và phân loại theo node_id
socket.on('updateData', (data) => {
    const id = data.node_id;

    // Nếu chưa có giao diện cho Node này thì tạo mới
    if (!nodesUI[id]) {
        createNodeUI(id);
    }

    
    const luxValue = data.lux !== undefined ? data.lux : (data.light_v || 0);

    // Cập nhật thời gian và thông số trên Card
    const now = new Date().toLocaleTimeString();
    document.getElementById(`time-${id}`).innerText = "Cập nhật lúc: " + now;
    document.getElementById(`temp-${id}`).innerText = data.temp;
    document.getElementById(`humi-${id}`).innerText = data.humi;
    document.getElementById(`light-${id}`).innerText = luxValue.toFixed(1); // Hiển thị 1 chữ số thập phân cho Lux
    document.getElementById(`motion-${id}`).innerText = data.motion ? "CÓ NGƯỜI" : "TRỐNG";

    // Đẩy dữ liệu vào biểu đồ tương ứng
    updateChart(nodesUI[id].temp, now, data.temp);
    updateChart(nodesUI[id].humi, now, data.humi);
    updateChart(nodesUI[id].light, now, luxValue); 
});


socket.on('mesh_alert', (data) => {
    // Đảm bảo id của thanh trạng thái khớp với file HTML của bạn 
    const statusBar = document.getElementById('status-bar') || document.getElementById('meshStatusBox');
    if (!statusBar) return;

    statusBar.innerText = data.msg;
    
    if (data.status === 'ALERT') {
        statusBar.style.background = "#f8d7da"; 
        statusBar.style.color = "#721c24";
        statusBar.style.animation = "blink 1s infinite"; 
    } else {
        statusBar.style.background = "#d4edda"; 
        statusBar.style.color = "#155724";
        statusBar.style.animation = "none";
    }
});

function updateChart(chart, label, value) {
    if (chart.data.labels.length > 15) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);
    chart.update('none');
}

function createChartConfig(label, color, min, max) {
    return {
        type: 'line',
        data: { labels: [], datasets: [{ label: label, data: [], borderColor: color, tension: 0.3, fill: false }] },
        options: { responsive: true, scales: { x: { display: false }, y: { min, max } } }
    };
}

// Hàm gửi gói dữ liệu cập nhật cấu hình ngưỡng mới từ Client xuống Server Laptop thông qua cổng Socket.io
function setThresholds() {
    // Đảm bảo Id của các ô nhập liệu (Input) trong HTML khớp với tên biến bên dưới
    const vals = {
        temp: parseFloat(document.getElementById('tempInput').value),
        humi: parseFloat(document.getElementById('humiInput').value),
        light: parseFloat(document.getElementById('lightInput').value)
    };
    
    // Đẩy ngược chuỗi cấu hình lên hàm io.on('connection') của file server.js
    socket.emit('set_threshold', vals);
    alert("Đã gửi lệnh cập nhật cấu hình ngưỡng tới hệ thống trung tâm!");
}