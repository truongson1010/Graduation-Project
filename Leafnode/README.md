PIR SENSOR
PIR (Passive Infrared Sensor) là cảm biến hồng ngoại thụ động.
Nó không phát tia mà chỉ nhận bức xạ hồng ngoại (nhiệt) từ cơ thể người/động vật.
Output:
-Mức HIGH (1) → có chuyển động.
-Mức LOW (0) → không có chuyển động.
*Lưu ý:
Chân OUT (tín hiệu) của PIR module thường là open collector / TTL output.
Khi không có chuyển động, PIR có thể xuất ra LOW nhưng đôi khi bị “trôi” → đọc sai trên ESP32.
Vì vậy ta cần dùng pull-down resistor hoặc cấu hình internal pull-down của ESP32 để giữ nó ở mức 0 khi không hoạt động.
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------




