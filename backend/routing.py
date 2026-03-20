import subprocess
import httpx
from pathlib import Path
from typing import List, Optional
from apscheduler.schedulers.background import BackgroundScheduler


class RoutingManager:
    """Менеджер для управления маршрутизацией и split-tunneling"""
    
    IPSET_NAME = "ru_ips"
    ROUTING_TABLE = 100
    FWMARK = 255
    
    def __init__(self):
        self.update_script = Path("/usr/local/bin/update_ru_ips.sh")
        self.scheduler = BackgroundScheduler()
        self.scheduler.add_job(self.update_ru_ipset, 'interval', hours=24)
        self.scheduler.start()
    
    def update_ru_ipset(self) -> bool:
        """Обновление списка IP-адресов России"""
        try:
            if self.update_script.exists():
                subprocess.run(["bash", str(self.update_script)], check=True)
                return True
        except Exception as e:
            print(f"Error updating ipset: {e}")
        return False
    
    def get_ipset_stats(self) -> dict:
        """Получение статистики ipset"""
        try:
            result = subprocess.run(
                ["ipset", "list", self.IPSET_NAME],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                lines = result.stdout.split('\n')
                count = 0
                for line in lines:
                    if line.startswith("Number of entries:"):
                        count = int(line.split(':')[1].strip())
                return {"name": self.IPSET_NAME, "entries": count, "status": "active"}
        except Exception:
            pass
        return {"name": self.IPSET_NAME, "entries": 0, "status": "inactive"}
    
    def get_routing_rules(self) -> List[dict]:
        """Получение правил маршрутизации"""
        rules = []
        try:
            # IP rules
            result = subprocess.run(
                ["ip", "rule", "list"],
                capture_output=True, text=True
            )
            for line in result.stdout.split('\n'):
                if str(self.FWMARK) in line or str(self.ROUTING_TABLE) in line:
                    rules.append({"type": "rule", "value": line})
            
            # IP routes in custom table
            result = subprocess.run(
                ["ip", "route", "list", "table", str(self.ROUTING_TABLE)],
                capture_output=True, text=True
            )
            for line in result.stdout.split('\n'):
                if line.strip():
                    rules.append({"type": "route", "value": line})
        
        except Exception:
            pass
        
        return rules
    
    def check_tunnel_status(self) -> dict:
        """Проверка статуса туннеля до DE-сервера"""
        try:
            # Проверяем интерфейс awg0
            result = subprocess.run(
                ["ip", "link", "show", "awg0"],
                capture_output=True, text=True
            )
            if result.returncode == 0 and "UP" in result.stdout:
                # Пингуем через туннель
                result = subprocess.run(
                    ["ping", "-c", "1", "-W", "2", "-I", "awg0", "8.8.8.8"],
                    capture_output=True, text=True
                )
                return {
                    "interface": "awg0",
                    "status": "up" if result.returncode == 0 else "no_connectivity"
                }
        except Exception:
            pass
        return {"interface": "awg0", "status": "down"}
    
    def setup_split_tunnel(self, interface: str = "awg-client") -> bool:
        """Настройка split-tunneling с поддержкой кастомных маршрутов"""
        import os
        try:
            bypass_ru = os.getenv("AWG_BYPASS_RU", "1") == "1"
            
            commands = [
                ["ipset", "create", self.IPSET_NAME, "hash:net"],
                ["ipset", "create", "custom_direct", "hash:net"],
                ["ipset", "create", "custom_vpn", "hash:net"],
                ["ipset", "add", self.IPSET_NAME, "10.0.0.0/8"],
                ["ipset", "add", self.IPSET_NAME, "192.168.0.0/16"],
                ["ipset", "add", self.IPSET_NAME, "172.16.0.0/12"],
                ["ip", "rule", "add", "fwmark", str(self.FWMARK), "lookup", str(self.ROUTING_TABLE)],
                ["ip", "route", "add", "default", "dev", "awg0", "table", str(self.ROUTING_TABLE)],
                ["iptables", "-t", "nat", "-A", "POSTROUTING", "-o", "awg0", "-j", "MASQUERADE"],
                ["iptables", "-t", "mangle", "-N", "AMNEZIA_PREROUTING"]
            ]
            
            for cmd in commands:
                subprocess.run(cmd, capture_output=True)
            
            # Привязываем кастомную цепочку, если еще не привязана
            res = subprocess.run(["iptables", "-t", "mangle", "-C", "PREROUTING", "-i", interface, "-j", "AMNEZIA_PREROUTING"], capture_output=True)
            if res.returncode != 0:
                subprocess.run(["iptables", "-t", "mangle", "-A", "PREROUTING", "-i", interface, "-j", "AMNEZIA_PREROUTING"])

            # Очищаем кастомную цепочку
            subprocess.run(["iptables", "-t", "mangle", "-F", "AMNEZIA_PREROUTING"])
            
            # Собираем правила
            rules = [
                ["iptables", "-t", "mangle", "-A", "AMNEZIA_PREROUTING", "-m", "set", "--match-set", "custom_vpn", "dst", "-j", "MARK", "--set-mark", str(self.FWMARK)],
                ["iptables", "-t", "mangle", "-A", "AMNEZIA_PREROUTING", "-m", "set", "--match-set", "custom_vpn", "dst", "-j", "RETURN"],
                ["iptables", "-t", "mangle", "-A", "AMNEZIA_PREROUTING", "-m", "set", "--match-set", "custom_direct", "dst", "-j", "RETURN"]
            ]
            
            if bypass_ru:
                rules.append(["iptables", "-t", "mangle", "-A", "AMNEZIA_PREROUTING", "-m", "set", "--match-set", self.IPSET_NAME, "dst", "-j", "RETURN"])
            
            rules.append(["iptables", "-t", "mangle", "-A", "AMNEZIA_PREROUTING", "-j", "MARK", "--set-mark", str(self.FWMARK)])
            
            for cmd in rules:
                subprocess.run(cmd)
            
            return True
        except Exception as e:
            print(f"Error setting up split tunnel: {e}")
            return False
    
    def sync_custom_routes(self, routes_list: List[dict]):
        """Берет список маршрутов, резолвит домены и обновляет ipset"""
        import socket
        subprocess.run(["ipset", "flush", "custom_direct"], capture_output=True)
        subprocess.run(["ipset", "flush", "custom_vpn"], capture_output=True)
        
        for route in routes_list:
            addr = route.get("address", "").strip()
            r_type = route.get("route_type")
            set_name = "custom_direct" if r_type == "direct" else "custom_vpn"
            
            is_ip = True
            for char in addr:
                if char.isalpha():
                    is_ip = False
                    break
                    
            ips_to_add = []
            if is_ip:
                ips_to_add.append(addr)
            else:
                try:
                    res = socket.getaddrinfo(addr, None, socket.AF_INET)
                    ips_to_add = list(set([r[4][0] for r in res]))
                except Exception:
                    pass
            
            for ip in ips_to_add:
                subprocess.run(["ipset", "add", set_name, ip], capture_output=True)
    
    def get_connection_stats(self) -> dict:
        """Получение общей статистики соединений"""
        stats = {
            "tunnel": self.check_tunnel_status(),
            "ipset": self.get_ipset_stats(),
            "rules_count": len(self.get_routing_rules())
        }
        return stats


# Глобальный экземпляр
routing_manager = RoutingManager()
