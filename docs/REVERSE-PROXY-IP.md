# Цепочка прокси: Caddy → nginx → Docker → API

Как в проде доходит реальный IP клиента до rate-limit, логов и Redis-статистики (`auth:stats:ip`).

## Схема

```
Пользователь (188.x.x.x)
        │
        ▼ HTTPS
┌───────────────────┐
│ Caddy (revers2)   │  220v.shop — публичный IP 158.160.217.206
│ /etc/caddy/       │  Видит клиента: {http.request.remote.host}
│   Caddyfile       │
└─────────┬─────────┘
          │ HTTPS → de.220v.shop
          │ по приватной сети (VPN/WG): TCP с 192.168.200.30
          │ заголовок: X-Client-Real-IP: <реальный IP клиента>
          ▼
┌───────────────────┐
│ nginx (vpnm)      │  /etc/nginx/sites-enabled/www.220v.shop
│ host, :80         │  set_real_ip_from 192.168.200.0/24
│                   │  real_ip_header X-Client-Real-IP
└─────────┬─────────┘
          │ HTTP → 127.0.0.1:9080 (docker publish)
          │ X-Real-IP / X-Forwarded-For = уже исправленный $remote_addr
          ▼
┌───────────────────┐
│ nginx (контейнер) │  nginx.conf в репозитории → образ letovpn-web
│ letovpn-web       │  real_ip из X-Forwarded-For (docker bridge 172.x.0.1)
└─────────┬─────────┘
          │ http://api:3001
          ▼
┌───────────────────┐
│ api (Express)     │  trust proxy = 1 → req.ip
│                   │  Redis: auth:stats:ip, rl:sendcode:ip:*, …
└───────────────────┘
```

## Почему «ломался» IP

На каждом hop без явной настройки в логах и статистике оказывается **IP предыдущего прокси**, а не клиента.

| Уровень | Без настройки видно | Причина |
|--------|---------------------|---------|
| host-nginx | `192.168.200.30` или `158.160.217.206` | TCP от Caddy по VPN; `X-Real-IP` от Caddy подставлял **свой** публичный IP |
| docker-nginx | `172.19.0.1` (шлюз bridge) | Docker NAT с `127.0.0.1:9080` |
| Redis / API | тот же «левый» IP | `req.ip` и rate-limit keys строятся из заголовков |

### Особенность Caddy 2.6.2

На revers2 стоит **Caddy 2.6.2**. В этом блоке:

```caddyfile
header_up X-Real-IP {remote_host}
header_up -X-Forwarded-For
```

в upstream уходило `X-Real-IP: 158.160.217.206` (IP самого Caddy), хотя `{http.request.remote.host}` в **кастомном** заголовке давал настоящий IP клиента.

Стандартные `X-Real-IP` / `X-Forwarded-For` в этой версии для upstream вели себя ненадёжно — поэтому используем **отдельный заголовок** `X-Client-Real-IP`, который Caddy не переписывает.

## Рабочая конфигурация

### 1. Caddy — revers2 (`/etc/caddy/Caddyfile`)

```caddyfile
220v.shop {
    reverse_proxy https://de.220v.shop {
        header_up Host {upstream_hostport}
        header_up X-Client-Real-IP "{http.request.remote.host}"
    }
}

www.220v.shop {
    redir https://220v.shop{uri} permanent
}
```

Применить:

```bash
caddy reload --config /etc/caddy/Caddyfile
```

Не полагаться на `header_up X-Real-IP` / `-X-Forwarded-For` для передачи клиентского IP в эту цепочку.

### 2. Host-nginx — vpnm (`/etc/nginx/sites-enabled/www.220v.shop`)

Доверяем только Caddy в приватной сети и читаем **кастомный** заголовок:

```nginx
server {
    listen 80;
    server_name www.220v.shop 220v.shop de.220v.shop;

    # IP Caddy в VPN (проверить: tail letovps-debug.log → realip=...)
    set_real_ip_from 192.168.200.0/24;
    real_ip_header X-Client-Real-IP;

    location / {
        proxy_pass http://127.0.0.1:9080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # location ^~ /api2/ … — PHP, без изменений
}
```

После `real_ip_header` переменная `$remote_addr` = реальный IP клиента. Дальше в Docker уходят уже правильные `X-Real-IP` и `X-Forwarded-For`.

```bash
nginx -t && systemctl reload nginx
```

Если подсеть VPN другая — смотреть в debug-лог поле `realip=` (см. ниже).

### 3. Docker-nginx — репозиторий (`nginx.conf`)

Уже настроено в образе `web`: доверяем приватным сетям и берём клиента из `X-Forwarded-For`, который прислал host-nginx:

```nginx
set_real_ip_from 127.0.0.1;
set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
set_real_ip_from 192.168.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Пересборка после правок:

```bash
docker compose up -d --build web
```

### 4. API (`api/index.mjs`)

```js
app.set("trust proxy", 1);
```

Один доверенный прокси перед Express (контейнерный nginx). `req.ip` используется в `recordAuthEvent`, rate-limit (`rl:*:ip:*`) и админке Redis.

## Проверка

### Быстрый тест

1. С телефона (мобильный интернет, не VPN) открыть `https://220v.shop/api/health`.
2. В админке `/admin/redis` в блоке **byIp** должен появиться ваш операторский IP, а не `158.160.217.206` и не `172.x.0.1`.

### Временный debug-лог на vpnm

`log_format` только в `http {}`:

```bash
# /etc/nginx/conf.d/00-letodbg.conf
log_format letodbg '$remote_addr -> realip=$realip_remote_addr | '
                   'x-client="$http_x_client_real_ip" | '
                   'xri="$http_x_real_ip" | xff="$http_x_forwarded_for" | '
                   'host="$host" | "$request"';
```

В `server { }` сайта:

```nginx
access_log /var/log/nginx/letovps-debug.log letodbg;
```

```bash
nginx -t && systemctl reload nginx
tail -f /var/log/nginx/letovps-debug.log
```

Ожидание после фикса:

```
188.233.12.87 -> realip=192.168.200.30 | x-client="188.233.12.87" | ...
```

- **первый столбец** (`$remote_addr`) — должен быть IP клиента;
- **realip** — TCP-источник (Caddy в VPN);
- **x-client** — то, что прислал Caddy.

Удалить отладку:

```bash
rm /etc/nginx/conf.d/00-letodbg.conf
# убрать access_log letodbg из sites-enabled
nginx -t && systemctl reload nginx
```

### Сброс старых счётчиков в Redis

```bash
docker exec v220-redis-1 redis-cli -a "$REDIS_PASSWORD" --no-auth-warning HDEL auth:stats:ip \
  158.160.217.206 192.168.200.30 172.19.0.1 unknown
```

## Чеклист при смене инфраструктуры

| Изменение | Что обновить |
|-----------|----------------|
| Новый IP/подсеть Caddy в VPN | `set_real_ip_from` на vpnm |
| Caddy на другом хосте | то же + `caddy reload` |
| Порт publish Docker (`9080`) | только `proxy_pass` на vpnm |
| Обновление Caddy до 2.8+ | можно попробовать снова `client_ip` / `trusted_proxies`; пока оставляем `X-Client-Real-IP` |
| Прямой доступ к `:9080` без host-nginx | реальный IP не придёт — нужен внешний proxy с заголовком |

## Связанные файлы в репозитории

| Файл | Роль |
|------|------|
| `nginx.conf` | real_ip в контейнере `web`, rate-limit по `$binary_remote_addr` |
| `docker-compose.yml` | `web` → `127.0.0.1:9080`, сеть `internal` |
| `api/index.mjs` | `trust proxy`, `AUTH_STATS_IP_KEY`, rate-limit generators |

## Другие домены на том же Caddy

Для `vpnm.su`, `heltoma.ru` и т.д. — та же схема: на revers2 `X-Client-Real-IP`, на целевом host-nginx свой `set_real_ip_from` (подсеть VPN) и `real_ip_header X-Client-Real-IP`.
