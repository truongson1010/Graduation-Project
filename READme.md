Nguyên tắc kết nối trong ESP-MESH:
+ Mạng mesh trong ESP32 được tổ chức theo cấu trúc cây (tree topology).
+ Root node là gốc của cây.
+ Các node khác (leaf,...) sẽ chọn “cha” (parent) dựa trên một số tiêu chí, để tạo thành nhánh cây.
+ Một node chỉ có 1 parent duy nhất, nhưng có thể có nhiều child.

Ưu điểm của ESP-MESH:
+ Mạng vẫn hoạt động khi 1 relay mất kết nối (tự chọn lại parent) theo cơ chế self-healing.
+ Có tính ổn định cao(mỗi child node chỉ có 1 parent node).

ESP-MESH phụ thuộc vào Wifi:
+ ESP-MESH của Espressif vẫn chạy trên Wi-Fi driver.
+ Tất cả node (root, parent, leaf) đều phải khởi tạo Wi-Fi stack (esp_netif_init(), esp_wifi_init(), esp_wifi_start()) thì Mesh layer mới hoạt động.
+ Mesh chỉ thay đổi cách Wi-Fi hoạt động (các node không kết nối AP ngoài, mà kết nối với parent node trong Mesh).

Các loại Node:
+ Root node: cần Wi-Fi + Mesh (Wi-Fi sẽ join router để có Internet).
+ parent node & Leaf node(child node): cũng cần Wi-Fi init (vì mesh phụ thuộc vào Wi-Fi driver), nhưng chúng không join router, chỉ tham gia vào Mesh.

Cách các Child node chọn parent node:
+ Cường độ tín hiệu Wi-Fi (RSSI): chọn parent có sóng mạnh nhất.
+ Độ sâu của cây (layer): Mesh cố gắng cân bằng, tránh chuỗi đến root node quá dài.
+ Khả năng tải (capacity): nếu một parent đã có quá nhiều child, Leaf(child) có thể chọn parent khác.

Khái quát về RSSI (Received signal strength indicator): chỉ số cường độ tín hiệu thu 
RSSI càng lớn thì độ mạnh của tín hiệu càng lớn. Chỉ số RSSI không sử dụng đơn vị đo và miền giá trị cụ thể, IEEE 802.11 cũng không định nghĩa việc chuyển đổi giữa chỉ số RSSI với các đơn vị tính công suất khác như mW hoặc dBm. Khi thiết bị thu càng gần thiết bị phát thì cường độ tín hiệu càng lớn và ngược lại. RSSI cũng được sử dụng để đo khoảng cách giữa thẻ RFID và thiết bị đọc thẻ.

Mô hình ESP-MESH:

              Leaf node (child node) --------------> Parent node 1 ----------------> Parent node 2 ---------------> Root node
                                 
                                              Parent node 3 (idle node)

# Graduation-Project
