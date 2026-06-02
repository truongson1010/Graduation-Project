#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include "esp_err.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_netif_ip_addr.h"
#include "esp_wifi.h"
#include "esp_mesh.h"
#include "mqtt_client.h"
#include "cJSON.h"

#define TAG "ROOT_NODE"

static const uint8_t MESH_ID[6] = { 0x7A, 0x10, 0x20, 0x30, 0x40, 0x50 };

#define ROUTER_SSID     "Adorable crab " 
#define ROUTER_PASS     "06062004"
// #define ROUTER_SSID     "Tinh Hoa" 
// #define ROUTER_PASS     "TinhHoa978"
#define ROUTER_CHANNEL  0 


//#define MQTT_URI         "mqtt://172.20.10.2:1883"  
#define MQTT_URI         "mqtt://192.168.1.9:1883"
#define MQTT_USERNAME    NULL                 
#define MQTT_PASSWORD    NULL


#define MQTT_DATA_TOPIC   "warehouse/sensors/data"
#define MQTT_STATUS_TOPIC "warehouse/mesh/status"

static esp_netif_t *g_mesh_netif_sta = NULL;
static esp_netif_t *g_mesh_netif_ap  = NULL;
static esp_mqtt_client_handle_t g_mqtt = NULL;
static bool g_mqtt_connected = false;

static void wifi_country_1_13(void) {
    wifi_country_t c = { .cc = "CN", .schan = 1, .nchan = 13, .policy = WIFI_COUNTRY_POLICY_MANUAL };
    esp_wifi_set_country(&c);
    esp_wifi_set_ps(WIFI_PS_NONE);
}

static void try_set_bw20(void) {
    wifi_mode_t m = WIFI_MODE_NULL;
    if (esp_wifi_get_mode(&m) != ESP_OK) return;
    if (m & WIFI_MODE_STA) esp_wifi_set_bandwidth(WIFI_IF_STA, WIFI_BW_HT20);
    if (m & WIFI_MODE_AP)  esp_wifi_set_bandwidth(WIFI_IF_AP,  WIFI_BW_HT20);
}


static void mqtt_evt_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data) {
    esp_mqtt_event_handle_t event = event_data; 
    switch (event_id) {
        case MQTT_EVENT_CONNECTED:
            g_mqtt_connected = true;
            ESP_LOGI(TAG, "MQTT: CONNECTED TO SERVER");
            // Gửi trạng thái thông báo hệ thống trực tuyến lên Dashboard
            esp_mqtt_client_publish(g_mqtt, MQTT_STATUS_TOPIC, "{\"status\":\"OK\",\"msg\":\"Hệ thống sẵn sàng. Mạng Mesh hoạt động ổn định.\"}", 0, 1, 0);
            break;
        case MQTT_EVENT_DISCONNECTED:
            g_mqtt_connected = false;
            ESP_LOGW(TAG, "MQTT: DISCONNECTED FROM SERVER");
            break;
        default: break;
    }
}

static void mqtt_start_if_needed(void) {
    if (g_mqtt) return; 
    esp_mqtt_client_config_t cfg = {
        .broker.address.uri = MQTT_URI,
        .credentials.username = MQTT_USERNAME,
        .credentials.authentication.password = MQTT_PASSWORD,
    };
    g_mqtt = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(g_mqtt, ESP_EVENT_ANY_ID, mqtt_evt_handler, NULL);
    esp_mqtt_client_start(g_mqtt);
}

static void ip_evt_handler(void *arg, esp_event_base_t base, int32_t id, void *event_data) {
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ev = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "GOT IP: " IPSTR, IP2STR(&ev->ip_info.ip));
        mqtt_start_if_needed(); 
    }
}

static void mesh_event_handler(void *arg, esp_event_base_t base, int32_t id, void *event_data) {
    char alert_buf[256];
    switch (id) {
        case MESH_EVENT_STARTED:
            ESP_LOGI(TAG, "Mesh started (ROOT)");
            break;
        case MESH_EVENT_PARENT_CONNECTED:
            if (esp_mesh_is_root()) {
                esp_netif_dhcpc_stop(g_mesh_netif_sta);
                esp_netif_dhcpc_start(g_mesh_netif_sta);
            }
            try_set_bw20();
            break;
        case MESH_EVENT_CHILD_CONNECTED: {
            mesh_event_child_connected_t *e = (mesh_event_child_connected_t*)event_data;
            ESP_LOGI(TAG, "Node con mới kết nối trực tiếp: " MACSTR ", aid=%d", MAC2STR(e->mac), e->aid);
            break;
        }
        case MESH_EVENT_CHILD_DISCONNECTED: {
            mesh_event_child_disconnected_t *e = (mesh_event_child_disconnected_t*)event_data;
            ESP_LOGW(TAG, "Node con đã ngắt kết nối: " MACSTR ", aid=%d", MAC2STR(e->mac), e->aid);
            break;
        }

        
        case MESH_EVENT_ROUTING_TABLE_REMOVE: {
            mesh_event_routing_table_change_t *e = (mesh_event_routing_table_change_t*)event_data;
            ESP_LOGW(TAG, "Bảng định tuyến sụt giảm nút! Giảm %d nút. Tổng số nút còn lại=%d", e->rt_size_change, e->rt_size_new);
            
            // Đẩy tin cảnh báo sự cố thực địa lên Server qua Wi-Fi
            if (g_mqtt_connected && g_mqtt) {
                snprintf(alert_buf, sizeof(alert_buf), 
                         "{\"status\":\"ALERT\",\"msg\":\"CẢNH BÁO: Phát hiện nút hạ tầng mất kết nối.\"}");
                esp_mqtt_client_publish(g_mqtt, MQTT_STATUS_TOPIC, alert_buf, 0, 1, 0);
            }
            break;
        }

        case MESH_EVENT_ROUTING_TABLE_ADD: {
            mesh_event_routing_table_change_t *e = (mesh_event_routing_table_change_t*)event_data;
            ESP_LOGI(TAG, "Mạng Mesh nhận lại nút / Tái kết nối thành công: +%d nút. Tổng=%d", e->rt_size_change, e->rt_size_new);
            
            
            if (g_mqtt_connected && g_mqtt) {
                snprintf(alert_buf, sizeof(alert_buf), 
                         "{\"status\":\"OK\",\"msg\":\" Hệ thống tự sửa lỗi (Self-Healing) thành công!.\"}");
                esp_mqtt_client_publish(g_mqtt, MQTT_STATUS_TOPIC, alert_buf, 0, 1, 0);
            }
            break;
        }
        default: break;
    }
}


static void mesh_recv_task(void *arg) {
    mesh_addr_t from;
    uint8_t rx_buf[512];
    mesh_data_t rx = { .data = rx_buf, .size = sizeof(rx_buf), .proto = MESH_PROTO_BIN, .tos = MESH_TOS_DEF };
    int flag = 0;

    for(;;){
        rx.size = sizeof(rx_buf);
        esp_err_t err = esp_mesh_recv(&from, &rx, portMAX_DELAY, &flag, NULL, 0);
        if (err == ESP_OK) {
            rx_buf[rx.size] = '\0';

            
            ESP_LOGI(TAG, "Nhận %u Bytes từ nút con [" MACSTR "]: %s", (unsigned)rx.size, MAC2STR(from.addr), (char*)rx_buf);

           
            if (g_mqtt_connected && g_mqtt) {
                esp_mqtt_client_publish(g_mqtt, MQTT_DATA_TOPIC, (const char*)rx.data, (int)rx.size, 0, 0);
            }
        }
    }
}

static void mesh_apply_config_open(void) {
    mesh_cfg_t cfg = MESH_INIT_CONFIG_DEFAULT();
    memcpy(cfg.mesh_id.addr, MESH_ID, 6);
    cfg.channel = ROUTER_CHANNEL;
    cfg.router.ssid_len = strlen(ROUTER_SSID);
    strlcpy((char*)cfg.router.ssid, ROUTER_SSID, sizeof(cfg.router.ssid));
    strlcpy((char*)cfg.router.password, ROUTER_PASS, sizeof(cfg.router.password));
    
    cfg.mesh_ap.max_connection = 2; 
    cfg.mesh_ap.nonmesh_max_connection = 0; 
    memset(cfg.mesh_ap.password, 0, sizeof(cfg.mesh_ap.password));

    ESP_ERROR_CHECK(esp_mesh_set_config(&cfg));
    ESP_ERROR_CHECK(esp_mesh_set_ap_authmode(WIFI_AUTH_OPEN));
}

void app_main(void) {
    ESP_LOGI(TAG, "ROOT node starting...");

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &ip_evt_handler, NULL));
    ESP_ERROR_CHECK(esp_netif_create_default_wifi_mesh_netifs(&g_mesh_netif_sta, &g_mesh_netif_ap));

    wifi_init_config_t wcfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wcfg));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_FLASH));
    wifi_country_1_13();
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_ERROR_CHECK(esp_mesh_init());
    ESP_ERROR_CHECK(esp_event_handler_register(MESH_EVENT, ESP_EVENT_ANY_ID, &mesh_event_handler, NULL));
    
   
    ESP_ERROR_CHECK(esp_mesh_set_self_organized(false, false));
    ESP_ERROR_CHECK(esp_mesh_set_max_layer(6));
    ESP_ERROR_CHECK(esp_mesh_set_type(MESH_ROOT));

    mesh_apply_config_open();
    ESP_ERROR_CHECK(esp_mesh_start());
    try_set_bw20();

    uint8_t sta_mac[6], ap_mac[6];
    esp_wifi_get_mac(WIFI_IF_STA, sta_mac);
    esp_wifi_get_mac(WIFI_IF_AP,  ap_mac);
    ESP_LOGI(TAG, "ROOT STA MAC : " MACSTR, MAC2STR(sta_mac));
    ESP_LOGI(TAG, "ROOT BSSID   : " MACSTR " (Mesh SoftAP)", MAC2STR(ap_mac));
    
    xTaskCreate(mesh_recv_task, "mesh_recv", 6144, NULL, 4, NULL);
}