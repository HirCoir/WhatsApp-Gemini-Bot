# WhatsApp Gemini Bot

<p align="center">
  <img src="image.png" alt="WhatsApp Gemini Bot" width="500">
</p>


[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repo-blue.svg)](https://github.com/HirCoir/WhatsApp-Gemini-Bot)

Un agente conversacional inteligente y autónomo para WhatsApp, impulsado por la IA de **Google Gemini**. Este bot puede mantener conversaciones fluidas, realizar búsquedas en internet en tiempo real para obtener respuestas actualizadas y responder con mensajes de voz sintetizados.

## 🛠️ Stack Tecnológico

*   **Entorno de Ejecución**: Node.js
*   **Conexión con WhatsApp**: `@whiskeysockets/baileys`
*   **Modelo de IA**: Google Gemini (a través de una API compatible con OpenAI)
*   **Búsqueda en Internet**: Tavily Search API
*   **Síntesis de Voz**: Compatible con cualquier API de TTS que acepte una solicitud POST.
*   **Dependencias Clave**: `axios`, `pino`, `qrcode-terminal`, `dotenv`.

---

## Características

- 🤖 Integración con Gemini AI para respuestas inteligentes
- 🔍 Búsqueda en internet mediante la API de Tavily
- 🎤 Conversión de texto a voz (opcional)
- 💾 Historial de conversaciones persistente
- 🎯 Preferencias de usuario personalizables
- 🔄 Rotación automática de claves API (de Tavily) para balanceo de carga

## Requisitos

- Node.js (versión recomendada: 22.x o superior)
- Una cuenta de WhatsApp para el bot
- API Key de Gemini (obligatorio)
- API Key de Tavily (recomendado para búsquedas en internet)
- Servicio de texto a voz (opcional)

## Instalación

1.  Clona este repositorio:
    ```bash
    git clone https://github.com/HirCoir/WhatsApp-Gemini-Bot
    cd WhatsApp-Gemini-Bot
    ```

2.  Instala las dependencias:

    > **Importante:** Es necesario tener **Git** instalado para que el comando `npm i` funcione correctamente, ya que algunas dependencias se descargan directamente desde sus repositorios.
    >
    > *   **En Debian/Ubuntu:**
    >     ```bash
    >     apt install git
    >     ```
    > *   **En Windows:**
    >     Descarga e instálalo desde: [https://git-scm.com/downloads/win](https://git-scm.com/downloads/win)

    ```bash
    npm install
    ```

3.  Configura las variables de entorno:
    *   Renombra el archivo `.env.example` a `.env`
    *   Edita el archivo `.env` con tus propias claves API y configuraciones

4.  Inicia el bot:
    ```bash
    node bot.js
    ```

5.  Escanea el código QR que aparece en la consola con tu WhatsApp para autenticar el bot.

## Configuración

El archivo `.env` contiene todas las configuraciones necesarias para el bot:

### Configuración obligatoria

```
GEMINI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
GEMINI_MODEL="gemini-2.5-pro"
GEMINI_API_KEY="tu-api-key-de-gemini"
```

*   **GEMINI_BASE_URL**: URL base para la API de Gemini
*   **GEMINI_MODEL**: Modelo de Gemini a utilizar (se recomienda gemini-2.5-pro para mejor funcionamiento)
*   **GEMINI_API_KEY**: Tu clave API de Gemini

### Configuración opcional

```
TAVILY_API_KEYS="key1|key2|key3"
TTS_API_BASE_URL=http://localhost:7860/api
TTS_API_TOKEN="tu_token_interno_seguro_aqui_12345" #No mover, este es el token literal
TTS_MODEL="es_MX-Maney"
```

*   **TAVILY_API_KEYS**: Claves API de Tavily para búsquedas en internet (separadas por `|`)
*   **TTS_API_BASE_URL**: URL base para el servicio de texto a voz
*   **TTS_API_TOKEN**: Token de autenticación para el servicio de texto a voz
*   **TTS_MODEL**: Modelo de voz predeterminado

## Servicio de Texto a Voz (Opcional)

El bot puede utilizar un servicio de texto a voz para enviar mensajes de audio. Si deseas utilizar esta función, puedes descargar el servicio de texto a voz desde:

```
https://huggingface.co/HirCoir/builds/resolve/main/api_tts.exe
```

Una vez descargado, ejecuta el archivo `api_tts.exe`, extrae la carpeta api, abre la carpeta api y ejecuta el .exe.

## Obtención de API Keys

### Gemini API

Para obtener una API Key de Gemini, visita la [consola de Google AI Studio](https://aistudio.google.com/apikey) y crea una nueva clave API.

### Tavily API

Para obtener una API Key de Tavily, visita [tavily.com](https://tavily.com/) y regístrate para obtener una cuenta. La API de Tavily es necesaria para que el bot pueda realizar búsquedas en internet.

## Comandos del Bot

*   `/clear`: Borra el historial de conversación
*   `/modelos`: Muestra los modelos de voz disponibles y permite seleccionar uno

## Estructura del Proyecto

*   `bot.js`: Archivo principal del bot
*   `auth-data-baileys/`: Directorio para almacenar los datos de autenticación de WhatsApp
*   `chat_histories/`: Directorio para almacenar los historiales de conversación
*   `user_preferences/`: Directorio para almacenar las preferencias de usuario
*   `tavily_usage.json`: Archivo para seguimiento del uso de la API de Tavily

## Contribuciones

Las contribuciones son bienvenidas. Si encuentras algún error o tienes alguna sugerencia, por favor abre un issue o envía un pull request.

## Licencia

Este proyecto está licenciado bajo la licencia MIT.