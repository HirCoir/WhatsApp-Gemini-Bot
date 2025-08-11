require('dotenv').config();

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    isJidGroup, 
    proto 
} = require('@whiskeysockets/baileys'); 
const pino = require('pino'); 
const qrcode = require('qrcode-terminal'); 
const path = require('path'); 
const fs = require('fs'); 
const OpenAI = require('openai'); 
const axios = require('axios'); 
const { Boom } = require('@hapi/boom');

// Interceptar y filtrar mensajes de error específicos en la consola
const originalConsoleError = console.error;
console.error = function() {
    // Filtrar errores "Bad MAC" y "Failed to decrypt message with any known session"
    const errorMsg = arguments[0];
    if (typeof errorMsg === 'string' && 
        (errorMsg.includes('Bad MAC') || 
         errorMsg.includes('Failed to decrypt message with any known session'))) {
        // Ignorar estos errores específicos
        return;
    }
    // Pasar otros errores al console.error original
    originalConsoleError.apply(console, arguments);
}; 
 
// Función para eliminar contenido Markdown 
function removeMarkdown(text) { 
    // Eliminar encabezados (ej. ###, ##, #) 
    text = text.replace(/^#+\s+/gm, ''); 
    // Eliminar negritas y cursivas (ej. **texto**, *texto*) 
    text = text.replace(/\*\*(.*?)\*\*/g, '$1'); 
    text = text.replace(/\*(.*?)\*/g, '$1'); 
    // Eliminar tachados (ej. ~~texto~~) 
    text = text.replace(/~~(.*?)~~/g, '$1'); 
    // Eliminar enlaces (ej. [texto](url)) 
    text = text.replace(/\[(.*?)\]\(.*?\)/g, '$1'); 
    // Eliminar listas (ej. * texto, - texto, 1. texto) 
    text = text.replace(/^\s*[\*\-\+]\s+/gm, ''); 
    text = text.replace(/^\s*\d+\.\s+/gm, ''); 
    // Eliminar bloques de código (ej. ```codigo```) 
    text = text.replace(/```.*?```/gs, ''); 
    // Eliminar líneas horizontales (ej. ---, ***) 
    text = text.replace(/^\s*[-*_]\s*[-*_]\s*[-*_]\s*$/gm, ''); 
    // Eliminar saltos de línea adicionales 
    text = text.replace(/\n{3,}/g, '\n\n'); 
    // Preservar formato básico para WhatsApp 
    text = text.replace(/\n\s*\n/g, '\n\n'); // Normalizar espacios entre párrafos 
 
    return text.trim(); 
} 
 
/*───────────────────────────────────────────────────────────────────────────*/ 
/*                        CONFIGURACIÓN DE OpenAI                           */ 
/*───────────────────────────────────────────────────────────────────────────*/ 
const openai = new OpenAI({ 
  apiKey: process.env.GEMINI_API_KEY, 
  baseURL: process.env.GEMINI_BASE_URL, 
}); 
 
/*───────────────────────────────────────────────────────────────────────────*/ 
/*                        CONFIGURACIÓN DE TTS API                          */ 
/*───────────────────────────────────────────────────────────────────────────*/ 
const TTS_API_BASE_URL = process.env.TTS_API_BASE_URL; 
const TTS_API_TOKEN = process.env.TTS_API_TOKEN; 
const DEFAULT_TTS_MODEL = process.env.TTS_MODEL || 'es_MX-laura_v2';
 
/*───────────────────────────────────────────────────────────────────────────*/ 
/*      CONFIGURACIÓN DE TAVILY API (BÚSQUEDA) CON ROTACIÓN DE CLAVES      */ 
/*───────────────────────────────────────────────────────────────────────────*/ 
const TAVILY_API_KEYS = (process.env.TAVILY_API_KEYS || '').split('|').filter(key => key.trim()); 
const TAVILY_USAGE_FILE = path.join(__dirname, 'tavily_usage.json'); 
 
// Funciones de lógica de negocio 
async function loadApiUsage() { 
    try { 
        const data = await fs.promises.readFile(TAVILY_USAGE_FILE, 'utf8'); 
        const usage = JSON.parse(data); 
        TAVILY_API_KEYS.forEach(key => { 
            if (usage[key] === undefined) usage[key] = 0; 
        }); 
        return usage; 
    } catch (err) { 
        if (err.code === 'ENOENT') { 
            console.log('📊 Creando archivo de seguimiento de uso para Tavily API...'); 
            const initialUsage = TAVILY_API_KEYS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {}); 
            await saveApiUsage(initialUsage); 
            return initialUsage; 
        } 
        console.error('❌ Error al leer el archivo de uso de API:', err); 
        return {}; 
    } 
} 
 
async function saveApiUsage(usageData) { 
    try { 
        await fs.promises.writeFile(TAVILY_USAGE_FILE, JSON.stringify(usageData, null, 2)); 
    } catch (err) { 
        console.error('❌ Error al guardar el archivo de uso de API:', err); 
    } 
} 
 
async function getNextApiKeyAndIncrement() { 
    if (!TAVILY_API_KEYS || TAVILY_API_KEYS.length === 0) { 
        console.error('❌ No hay API keys de Tavily configuradas.'); 
        return null; 
    } 
    const usage = await loadApiUsage(); 
    let selectedKey = TAVILY_API_KEYS.reduce((minKey, currentKey) => usage[currentKey] < usage[minKey] ? currentKey : minKey); 
    usage[selectedKey]++; 
    console.log(`🔑 Usando la clave de Tavily: ...${selectedKey.slice(-4)}. Uso total de esta clave: ${usage[selectedKey]}.`); 
    await saveApiUsage(usage); 
    return selectedKey; 
} 
 
const histDir = path.join(__dirname, 'chat_histories'); 
if (!fs.existsSync(histDir)) fs.mkdirSync(histDir); 
 
async function getHistory(chatId) { 
    const userHistFile = path.join(histDir, `${chatId}.json`); 
    try { 
        const data = await fs.promises.readFile(userHistFile, 'utf8'); 
        return JSON.parse(data); 
    } catch (err) { 
        if (err.code === 'ENOENT') return []; 
        console.error(`❌ Error al leer el historial de ${chatId}:`, err); 
        return []; 
    } 
} 
 
async function setHistory(chatId, history) { 
    const userHistFile = path.join(histDir, `${chatId}.json`); 
    try { 
        await fs.promises.writeFile(userHistFile, JSON.stringify(history, null, 2)); 
    } catch (err) { 
        console.error(`❌ Error al guardar el historial de ${chatId}:`, err); 
    } 
} 
 
async function clearHistory(chatId) { 
    const userHistFile = path.join(histDir, `${chatId}.json`); 
    try { 
        if (fs.existsSync(userHistFile)) { 
            await fs.promises.unlink(userHistFile); 
            console.log(`🧹 Historial de ${chatId} eliminado.`); 
            return true; 
        } 
        return false; 
    } catch (err) { 
        console.error(`❌ Error al eliminar el historial de ${chatId}:`, err); 
        return false; 
    } 
} 
 
const prefsDir = path.join(__dirname, 'user_preferences'); 
if (!fs.existsSync(prefsDir)) fs.mkdirSync(prefsDir); 
 
async function loadUserPreferences(chatId) { 
    const userPrefsFile = path.join(prefsDir, `${chatId}.json`); 
    try { 
        const data = await fs.promises.readFile(userPrefsFile, 'utf8'); 
        return JSON.parse(data); 
    } catch (err) { 
        if (err.code === 'ENOENT') return {}; 
        console.error(`❌ Error al leer las preferencias de ${chatId}:`, err); 
        return {}; 
    } 
} 
 
async function saveUserPreferences(chatId, prefs) { 
    const userPrefsFile = path.join(prefsDir, `${chatId}.json`); 
    try { 
        await fs.promises.writeFile(userPrefsFile, JSON.stringify(prefs, null, 2)); 
    } catch (err) { 
        console.error(`❌ Error al guardar las preferencias de ${chatId}:`, err); 
    } 
} 
 
async function chatWithGemini(messages) { 
    try { 
        const completion = await openai.chat.completions.create({ 
            model: process.env.GEMINI_MODEL || 'models/gemini-1.5-pro-latest', 
            messages: messages, 
            temperature: 0.6, 
        }); 
        const reply = completion.choices[0]?.message?.content?.trim() ?? ''; 
        console.log('[Gemini] Respuesta/Acción:', reply); 
        return reply; 
    } catch (err) { 
        console.error('❌ Error al llamar a Gemini:', err); 
        if (err.response?.status === 429) {
            return 'Lo siento, el servicio está experimentando alta demanda. Por favor, intenta de nuevo en unos momentos.';
        }
        return 'Lo siento, hubo un error al procesar tu mensaje.'; 
    } 
} 
 
async function textToSpeech(text, chatId) { 
    if (!TTS_API_BASE_URL || !TTS_API_TOKEN) {
        console.log('⚠️ TTS no configurado. Omitiendo conversión de texto a voz.');
        return null;
    }
    
    const MAX_TTS_LENGTH = 100000;
    if (text.length > MAX_TTS_LENGTH) {
        console.log(`⚠️ Texto demasiado largo para TTS (${text.length} caracteres). Truncando a ${MAX_TTS_LENGTH} caracteres.`);
        text = text.substring(0, MAX_TTS_LENGTH) + '...';
    }
    
    const userPrefs = await loadUserPreferences(chatId); 
    const modelId = userPrefs.tts_model || DEFAULT_TTS_MODEL; 
    console.log(`🎤 Usando modelo de voz "${modelId}" para el chat ${chatId}.`); 
    try { 
        const response = await axios({ 
            method: 'post', 
            url: `${TTS_API_BASE_URL}/convert`, 
            headers: { 'Authorization': `Bearer ${TTS_API_TOKEN}`, 'Content-Type': 'application/json' }, 
            data: { text: text, model: modelId }, 
            responseType: 'arraybuffer',
            timeout: 3600000
        }); 
        return response.data; 
    } catch (error) { 
        console.error('❌ Error en la conversión TTS:', error.message); 
        if (error.response) {
            console.error(`  Status: ${error.response.status}`);
            console.error(`  Datos: ${error.response.data ? error.response.data.toString() : 'No disponible'}`);
        }
        return null; 
    } 
} 
 
async function getAvailableTTSModels() { 
    if (!TTS_API_BASE_URL || !TTS_API_TOKEN) {
        console.log('⚠️ TTS no configurado. No se pueden obtener modelos de voz.');
        return null;
    }
    
    try { 
        console.log(`📡 Solicitando modelos de voz desde: ${TTS_API_BASE_URL}/models`); 
        const response = await axios.get(`${TTS_API_BASE_URL}/models`, { 
            headers: { 'Authorization': `Bearer ${TTS_API_TOKEN}` } 
        }); 
        return response.data?.success ? response.data.models : []; 
    } catch (error) { 
        console.error('❌ Error al obtener los modelos de voz TTS:', error.message); 
        return null; 
    } 
} 
 
async function searchOnInternet(queries) { 
    if (!TAVILY_API_KEYS || TAVILY_API_KEYS.length === 0) {
        console.log('⚠️ No hay claves de Tavily configuradas. No se puede realizar búsqueda.');
        return "Error: No se pudo realizar la búsqueda porque el servicio no está configurado.";
    }
    
    console.log(`🔍 Realizando ${queries.length} búsquedas en internet: ${queries.join(', ')}`); 
    const apiKeyToUse = await getNextApiKeyAndIncrement(); 
    if (!apiKeyToUse) return "Error: No se pudo obtener una clave de API de Tavily."; 
    const searchPromises = queries.map(query => 
        axios.post('https://api.tavily.com/search', { 
            api_key: apiKeyToUse, 
            query: query, 
            search_depth: 'advanced', 
            include_answer: true, 
            max_results: 5 
        }).catch(error => ({ 
            error: true, 
            query: query, 
            data: error.response ? JSON.stringify(error.response.data) : error.message 
        })) 
    ); 
    try { 
        const responses = await Promise.all(searchPromises); 
        let consolidatedResults = "Resultados de las búsquedas múltiples:\n\n"; 
        responses.forEach((response, index) => { 
            const query = queries[index]; 
            consolidatedResults += `--- Búsqueda ${index + 1}: "${query}" ---\n`; 
            if (response.error) { 
                consolidatedResults += `Error en esta búsqueda: ${response.data}\n\n`; 
                return; 
            } 
            const { answer, results } = response.data; 
            consolidatedResults += `Respuesta directa: ${answer || 'No disponible'}\n`; 
            if (results?.length > 0) { 
                consolidatedResults += "Fuentes:\n"; 
                results.forEach((res, i) => { 
                    consolidatedResults += `${i + 1}. [${res.title}](${res.url}):\n   - ${res.content}\n`; 
                }); 
            } else { 
                consolidatedResults += "No se encontraron fuentes.\n"; 
            } 
            consolidatedResults += "\n"; 
        }); 
        return consolidatedResults; 
    } catch (error) { 
        console.error(`❌ Error fatal durante la búsqueda múltiple: ${error.message}`); 
        return `Error: No se pudieron completar las búsquedas.`; 
    } 
} 
 
/*───────────────────────────────────────────────────────────────────────────*/ 
/*         FUNCIÓN PRINCIPAL Y MANEJO DE EVENTOS (BAILEYS) - CORREGIDO       */ 
/*───────────────────────────────────────────────────────────────────────────*/ 
async function startBot() { 
    const authDir = path.join(__dirname, 'auth-data-baileys'); 
    const { state, saveCreds } = await useMultiFileAuthState(authDir); 
 
    const sock = makeWASocket({ 
        auth: state, 
        logger: pino({ level: 'silent' }) 
    }); 
 
    sock.ev.on('creds.update', saveCreds); 
 
    // ▼▼▼ INICIO DE LA SECCIÓN MODIFICADA ▼▼▼
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('------------------------------------------------');
            console.log('🔐 Escanea el código QR con tu móvil para conectar:');
            qrcode.generate(qr, { small: true });
            console.log('------------------------------------------------');
        }

        if (connection === 'open') {
            console.log('✅ Bot Agente-Gemini v2.1 (Baileys) listo y conectado ✅');
        }

        if (connection === 'close') {
            const lastDisconnectError = lastDisconnect?.error;
            const statusCode = (lastDisconnectError instanceof Boom) ? lastDisconnectError.output.statusCode : 500;
            
            // Comprobamos si el error es 'loggedOut'
            if (statusCode === DisconnectReason.loggedOut) {
                console.log('🚫 Conexión cerrada: La sesión ha sido cerrada (loggedOut).');
                console.log('🗑️ Eliminando la carpeta de sesión para forzar una nueva vinculación...');
                
                try {
                    // Eliminamos la carpeta de autenticación de forma síncrona
                    if (fs.existsSync(authDir)) {
                        fs.rmSync(authDir, { recursive: true, force: true });
                        console.log('📁 Carpeta de sesión eliminada exitosamente.');
                    }
                } catch (err) {
                    console.error('❌ Error al eliminar la carpeta de sesión:', err);
                }

                console.log('🔄 Reiniciando el proceso del bot para generar un nuevo código QR...');
                // Volvemos a llamar a startBot() para que inicie de cero
                startBot();

            } else {
                // Para cualquier otro tipo de error, intentamos reconectar
                console.log(`❌ Conexión cerrada. Error: ${lastDisconnectError?.message || 'Desconocido'}. Intentando reconectar...`);
                startBot();
            }
        }
    });
    // ▲▲▲ FIN DE LA SECCIÓN MODIFICADA ▲▲▲
 
    sock.ev.on('messages.upsert', async (m) => { 
        const msg = m.messages[0]; 
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') { 
            return; 
        } 
        if (isJidGroup(msg.key.remoteJid)) { 
            return; 
        } 
 
        const chatId = msg.key.remoteJid; 
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || ''; 
        if (!body.trim()) return; 
 
        console.log(`\n📩 Mensaje recibido de ${chatId}: ${body}`); 
        try { 
            const userPrefs = await loadUserPreferences(chatId); 
            if (userPrefs.state === 'awaiting_model_choice') { 
                if (body.toLowerCase() === '/cancelar') { 
                    delete userPrefs.state; 
                    delete userPrefs.available_models; 
                    await saveUserPreferences(chatId, userPrefs); 
                    await sock.sendMessage(chatId, { text: '👍 Selección de voz cancelada.' }); 
                    return; 
                } 
                const choiceIndex = parseInt(body, 10) - 1; 
                const availableModels = userPrefs.available_models; 
                if (availableModels && !isNaN(choiceIndex) && choiceIndex >= 0 && choiceIndex < availableModels.length) { 
                    const selectedModel = availableModels[choiceIndex]; 
                    userPrefs.tts_model = selectedModel.id; 
                    delete userPrefs.state; 
                    delete userPrefs.available_models; 
                    await saveUserPreferences(chatId, userPrefs); 
                    await sock.sendMessage(chatId, { text: `✅ ¡Perfecto! He configurado tu voz a *${selectedModel.name}*.` }); 
                    console.log(`🎤 Modelo de voz para ${chatId} actualizado a ${selectedModel.id}.`); 
                    return; 
                } else { 
                    await sock.sendMessage(chatId, { text: 'Ups, ese número no es válido. Por favor, elige un número de la lista o envía /cancelar para salir.' }); 
                    return; 
                } 
            } 
 
            if (body.toLowerCase() === '/clear') { 
                await clearHistory(chatId); 
                await sock.sendMessage(chatId, { text: '✅ Tu historial de conversación ha sido eliminado.' }); 
                return; 
            } 
 
            if (body.toLowerCase() === '/modelos' || body.toLowerCase() === '/voices') { 
                if (!TTS_API_BASE_URL || !TTS_API_TOKEN) {
                    await sock.sendMessage(chatId, { text: 'El sistema de voz no está configurado en este servidor. No se pueden obtener modelos de voz.' });
                    return;
                }
                
                await sock.sendMessage(chatId, { text: 'Buscando modelos de voz disponibles, un momento...' }); 
                const models = await getAvailableTTSModels(); 
                if (models === null) { 
                    await sock.sendMessage(chatId, { text: 'Lo siento, no pude contactar al servicio de voces en este momento. Inténtalo de nuevo más tarde.' }); 
                    return; 
                } 
                if (models && models.length > 0) { 
                    let modelListText = 'Elige un modelo de voz respondiendo con el número correspondiente:\n\n'; 
                    models.forEach((model, index) => { 
                        modelListText += `${index + 1}. *${model.name}*\n   _${model.description || 'Voz estándar.'}_\n`; 
                    }); 
                    modelListText += '\nEnvía /cancelar para salir de la selección.'; 
 
                    userPrefs.state = 'awaiting_model_choice'; 
                    userPrefs.available_models = models.map(m => ({ id: m.id, name: m.name })); 
                    await saveUserPreferences(chatId, userPrefs); 
 
                    await sock.sendMessage(chatId, { text: modelListText }); 
                } else { 
                    await sock.sendMessage(chatId, { text: 'No encontré modelos de voz disponibles en el sistema.' }); 
                } 
                return; 
            } 
 
            const permanentHistory = await getHistory(chatId); 
            let turnContext = [ 
                { role: 'system', 
                  content: 
                  'Eres Gemini, un agente de IA para WhatsApp. Tu objetivo es proporcionar respuestas precisas y actuales usando herramientas de búsqueda de forma autónoma.\n\n' + 
                  '## PROCESO DE PENSAMIENTO AUTÓNOMO ##\n' + 
                  '1.  **Analiza:** Recibes un mensaje del usuario.\n' + 
                  '2.  **Planifica y Ejecuta Búsqueda:** Si necesitas información actual, responde ÚNICAMENTE con el comando `buscar:`. Puedes hacer múltiples búsquedas separadas por `|`.\n' + 
                  '    - Formato: `buscar: [pregunta 1] | [pregunta 2]`\n' + 
                  '    - Ejemplo: `buscar: precio actual de Bitcoin | últimas noticias sobre la inteligencia artificial`\n' + 
                  '3.  **Recibe Resultados:** El sistema te entregará los resultados de tu búsqueda.\n' + 
                  '4.  **Evalúa y Re-busca (Opcional):** Analiza los resultados. Si son insuficientes, puedes volver al paso 2 y ejecutar una nueva búsqueda para obtener más detalles. Este es tu poder autónomo.\n' + 
                  '## >> SÍNTESIS FINAL (ACCIÓN OBLIGATORIA) << ##\n' + 
                  '5.  **Una vez que tengas información suficiente de tus búsquedas, tu ÚNICA y ÚLTIMA tarea es generar la respuesta final para el usuario.**\n' + 
                  '    - **NO** emitas más comandos `buscar`.\n' + 
                  '    - **FORMATO ESTRICTO:** La respuesta DEBE ser **texto plano**. No incluyas NUNCA markdown (como `*negrita*`, `_cursiva_`, `~tachado~`, `[]()`), código, o emojis.\n' + 
                  '    - **OBJETIVO:** Sintetiza toda la información en una respuesta corta, precisa y en lenguaje natural para WhatsApp (2-5 líneas).\n\n' + 
                  '**IMPORTANTE:** Las notificaciones que el sistema envía al usuario ("Buscando...") son para su información y NO forman parte de nuestro historial. Ignóralas.' 
                }, 
                ...permanentHistory, 
                { role: 'user', content: body } 
            ]; 
            let finalReply = ''; 
            const MAX_ATTEMPTS = 3; 
            let editableMessageKey = null; 
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) { 
                console.log(`\n🔄 Inciando ciclo de pensamiento #${attempt}`); 
 
                const modelResponse = await chatWithGemini(turnContext); 
                if (modelResponse.toLowerCase().startsWith('buscar:')) { 
                    console.log('🤖 El modelo solicita una o más búsquedas.'); 
                    turnContext.push({ role: 'assistant', content: modelResponse }); 
                    const searchPart = modelResponse.substring('buscar:'.length).trim(); 
                    const queries = searchPart.split('|').map(q => q.trim()).filter(q => q); 
                    if (queries.length > 0) { 
                        const statusMessage = `✍️ _Buscando: ${queries.join(', ')}..._`; 
 
                        if (!editableMessageKey) { 
                            const sentMsg = await sock.sendMessage(chatId, { text: statusMessage }); 
                            editableMessageKey = sentMsg.key; 
                        } else { 
                            await sock.sendMessage(chatId, { text: statusMessage, edit: editableMessageKey }); 
                        } 
                        const searchResults = await searchOnInternet(queries); 
                        console.log("📄 Resultados de búsqueda consolidados recibidos."); 
                        turnContext.push({ role: 'system', content: searchResults }); 
                        continue; 
                    } 
                } 
 
                finalReply = modelResponse; 
                break; 
            } 
 
            if (!finalReply) { 
                finalReply = "Lo siento, no pude procesar tu solicitud después de varios intentos. Por favor, intenta reformular tu pregunta."; 
            } 
            
            finalReply = removeMarkdown(finalReply);
            
            try {
                if (editableMessageKey) { 
                    await sock.sendMessage(chatId, { text: finalReply, edit: editableMessageKey }); 
                    console.log(`💬 Mensaje editado y enviado a ${chatId}`); 
                } else { 
                    await sock.sendMessage(chatId, { text: finalReply }); 
                    console.log(`💬 Respuesta de texto enviada a ${chatId}`); 
                }
            } catch (error) {
                console.error('❌ Error al enviar mensaje de texto:', error);
                try {
                    await sock.sendMessage(chatId, { text: finalReply });
                    console.log(`💬 Mensaje enviado como nuevo tras error de edición a ${chatId}`);
                } catch (secondError) {
                    console.error('❌ Error fatal al enviar mensaje:', secondError);
                }
            } 
 
            if (finalReply) { 
                permanentHistory.push({ role: 'user', content: body }); 
                permanentHistory.push({ role: 'assistant', content: finalReply }); 
                if (permanentHistory.length > 20) permanentHistory.splice(0, permanentHistory.length - 20); 
                await setHistory(chatId, permanentHistory); 
                console.log("💾 Historial de conversación permanente actualizado."); 
                
                if (TTS_API_BASE_URL && TTS_API_TOKEN) {
                    try {
                        const audioBuffer = await textToSpeech(finalReply, chatId); 
                        if (audioBuffer) { 
                            try {
                                await sock.sendMessage(chatId, { 
                                    audio: audioBuffer, 
                                    mimetype: 'audio/mpeg', 
                                    ptt: true 
                                }); 
                                console.log(`🎤 Audio enviado a ${chatId}`); 
                            } catch (audioSendError) {
                                console.error('❌ Error al enviar audio:', audioSendError.message);
                                try {
                                    await sock.sendMessage(chatId, { 
                                        text: "No pude enviarte un mensaje de voz, pero puedes leer mi respuesta arriba." 
                                    });
                                } catch (e) {
                                    console.error('❌ Error al enviar mensaje de error de audio:', e.message);
                                }
                            }
                        } else {
                            console.log('⚠️ No se pudo generar audio para este mensaje.');
                        }
                    } catch (ttsError) {
                        console.error('❌ Error en el proceso de TTS:', ttsError.message);
                    }
                } else {
                    console.log('ℹ️ Sistema de voz desactivado: TTS_API_BASE_URL o TTS_API_TOKEN no definidos.');
                }
            } 
        } catch (err) { 
            console.error('❌ Error fatal al procesar el mensaje:', err); 
            try { 
                await sock.sendMessage(chatId, { text: 'Lo siento, ocurrió un error interno muy grave. Inténtalo de nuevo.' }); 
            } catch (e) { 
                console.error('❌ Error al enviar mensaje de error:', e); 
            } 
        } 
    }); 
} 
 
// Inicialización del bot 
(async () => { 
  await loadApiUsage(); 
  startBot(); 
})();