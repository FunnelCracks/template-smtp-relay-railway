# smtp-relay-resend

Relay de correo para Railway: recibe SMTP por la red privada del proyecto y
reenvía cada mensaje por la **API HTTPS de Resend**.

---

## Por qué existe

Railway **bloquea el SMTP saliente** en los planes Free, Trial y Hobby, para
prevenir spam. Y Vaultwarden (como la mayoría de aplicaciones autoalojadas) solo
sabe hablar SMTP: no puede llamar a una API HTTP para enviar correo.

Este servicio hace de traductor entre ambos:

```
App --SMTP--> relay (red privada de Railway) --HTTPS--> Resend --> destinatario
```

El HTTPS saliente **no** está bloqueado en ningún plan, así que el correo sale sin
problema.

Si estás en plan **Pro**, no necesitas esto: apunta tu aplicación directamente a
tu proveedor SMTP.

---

## Despliegue

### 1. Resend

1. Crea una cuenta en [resend.com](https://resend.com) — el plan gratuito cubre
   3.000 emails al mes
2. **Domains** → `Add Domain` → añade los registros SPF y DKIM en tu DNS
   (si usas Cloudflare, con la nube **gris**, no naranja)
3. Espera a que el dominio aparezca como **Verified**
4. **API Keys** → `Create API Key` con permiso **Sending access**

> No hay que dar de alta remitentes. Una vez verificado el dominio, puedes enviar
> desde cualquier dirección de ese dominio. El remitente se indica en cada envío.

### 2. Railway

En el **mismo proyecto** que la aplicación que va a enviar correo:

`+ New` → `GitHub Repo` → este repo

Railway detecta Node por el `package.json`. No hace falta Dockerfile.

**Variables:**

```
RESEND_API_KEY=re_xxxxx
PORT=2525
DEFAULT_FROM=vault@tudominio.com
```

### 3. No generes dominio público

> ⚠️ **Crítico.** En Settings → Networking, **no generes un dominio**. Sin él, el
> servicio solo es accesible por `*.railway.internal` desde dentro del proyecto.
>
> Un relay SMTP abierto a internet se convierte en máquina de spam en cuestión de
> horas.

Al desplegar, en los logs:

```
[relay] Escuchando SMTP en el puerto 2525 (red privada)
```

### 4. Apuntar la aplicación

Coge el hostname interno en Settings → Networking → **Private Networking** del
relay. Tendrá la forma `nombre-del-servicio.railway.internal`.

En las variables de la aplicación que envía (ejemplo para Vaultwarden):

```
SMTP_HOST=smtp-relay-resend.railway.internal
SMTP_PORT=2525
SMTP_SECURITY=off
SMTP_FROM=vault@tudominio.com
SMTP_FROM_NAME=Vaultwarden
```

Y **borra** `SMTP_USERNAME` y `SMTP_PASSWORD` si las tenías: el relay no pide
autenticación.

`SMTP_SECURITY=off` es correcto aquí. Ese tramo va por la red privada de Railway
y no sale a internet en claro; el cifrado real lo pone el relay al hablar con
Resend por HTTPS.

---

## Verificar

Envía un correo de prueba desde tu aplicación y mira los **logs del relay**:

```
[relay] -> tu@email.com | Test email
[relay] OK tu@email.com
```

---

## Diagnóstico

| Síntoma | Causa |
|---|---|
| Nada en los logs del relay | La aplicación no llega a conectar. Revisa el hostname `.railway.internal` y el puerto |
| `Resend 403` | API key incorrecta o sin permiso de envío |
| `Resend 422` | El dominio del remitente no está verificado en Resend |
| Timeout desde la aplicación | ¿Generaste dominio público por error? Comprueba que ambos servicios están en el mismo proyecto |

---

## Notas técnicas

- Escucha en `::` porque la red privada de Railway es **IPv6**
- Sin TLS ni AUTH: el tráfico no sale de la red privada
- Límite de 25 MB por mensaje
- Reenvía HTML, texto plano y adjuntos (en base64)
- Si Resend rechaza un mensaje, el relay devuelve error SMTP al emisor para que
  el fallo se vea en el log de la aplicación, no solo aquí

## Usar otro proveedor

El código llama a `https://api.resend.com/emails`. Para Postmark, Brevo o
SendGrid, cambia esa URL, la cabecera de autenticación y los nombres de los
campos del payload en la función `sendViaResend`. El resto no cambia.
