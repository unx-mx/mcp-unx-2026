import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

dotenv.config();

// 1. Configuración Inicial del Servidor Express
const app = express();

// Habilitar CORS para permitir peticiones desde cualquier origen
app.use(cors());

// --- ¡CORRECCIÓN IMPORTANTE! ---
// Habilitar lectura de JSON en las peticiones. Vital para que ChatbotBuilder pueda enviar mensajes.
app.use(express.json()); 

// Conexión a Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Creación del Servidor MCP
const mcpServer = new McpServer({
  name: "UNX Course Agent",
  version: "1.0.0",
});

// --- DEFINICIÓN DE HERRAMIENTAS (TOOLS) ---

// TOOL 1: Obtener lista general de cursos activos
mcpServer.tool(
  "get_active_courses",
  "Obtiene una lista de los cursos disponibles actualmente, con precios base y modalidades. Úsalo cuando el usuario pregunte qué cursos ofrecemos.",
  {}, 
  async () => {
    console.log("🔧 Ejecutando Tool: get_active_courses");
    const { data, error } = await supabase
      .from('courses')
      .select('name, modality, price_promo, start_date, schedule_summary')
      .eq('status', 'active');

    if (error) {
      console.error("Error Supabase:", error);
      return { content: [{ type: "text", text: `Error consultando base de datos: ${error.message}` }] };
    }
    
    // Formateamos la respuesta
    const formatted = data.map(c => 
      `- ${c.name} (${c.modality}): Inicia ${c.start_date}. Promo: $${c.price_promo}. Horario: ${c.schedule_summary}`
    ).join("\n");

    return { content: [{ type: "text", text: `Cursos disponibles actualmente:\n${formatted}` }] };
  }
);

// TOOL 2: Obtener detalle específico de un curso
mcpServer.tool(
  "get_course_details",
  "Obtiene TODA la información detallada de un curso específico (descripción, qué incluye, fechas exactas, precios, links). Úsalo cuando el usuario muestre interés en un curso concreto.",
  {
    keyword: z.string().describe("Una palabra clave del curso, ej: 'Integral', 'Exponencial'"),
    modality: z.string().describe("La modalidad buscada, ej: 'Presencial', 'Zoom'")
  },
  async ({ keyword, modality }) => {
    console.log(`🔧 Ejecutando Tool: get_course_details para ${keyword} - ${modality}`);
    
    // Buscamos en la base de datos
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .ilike('name', `%${keyword}%`) // Busca coincidencia parcial
      .ilike('modality', `%${modality}%`) 
      .eq('status', 'active')
      .limit(1);

    if (error) return { content: [{ type: "text", text: `Error en base de datos: ${error.message}` }] };
    
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: `No encontré información activa para el curso '${keyword}' en modalidad '${modality}'. Por favor verifica el nombre o la modalidad.` }] };
    }

    const course = data[0];
    
    const info = `
--- DETALLES DEL CURSO: ${course.name} (${course.modality}) ---
📅 Inicio: ${course.start_date} | Fin: ${course.end_date}
💰 Precio Lista: $${course.price_list}
🏷️ Precio Promo: $${course.price_promo} (Válido hasta: ${course.promo_deadline})
💸 Apartado: $${course.down_payment}
⏰ Horarios: ${course.schedule_summary}
🔗 Link Compra: ${course.purchase_url}
🖼️ Imagen: ${course.image_url}

LO QUE INCLUYE:
${course.description}
    `;

    return { content: [{ type: "text", text: info }] };
  }
);

// --- CONFIGURACIÓN DE RUTAS (ENDPOINTS) ---

// 1. Endpoint SSE: Inicia la conexión
app.get('/sse', async (req, res) => {
  // Validación de seguridad (Soporta Headers y URL Query)
  const apiKey = req.headers['x-api-key'] || req.query.key;
  
  if (apiKey !== process.env.MCP_API_KEY) {
    console.log(`⚠️ Intento de conexión fallido. Key recibida: ${apiKey}`);
    res.status(401).send('Unauthorized: Invalid API Key');
    return;
  }

  console.log("✅ Nueva conexión SSE establecida desde ChatbotBuilder");
  
  const transport = new SSEServerTransport("/messages", res);
  await mcpServer.connect(transport);
});

// 2. Endpoint Mensajes: Procesa las peticiones POST de ChatbotBuilder
app.post('/messages', async (req, res) => {
  console.log("📨 Recibido mensaje POST (ChatbotBuilder está pidiendo info)");
  
  // Aquí es donde procesamos la lógica del protocolo MCP
  await mcpServer.processPostMessage(req, res);
});

// Arrancar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor MCP UNX listo en puerto ${PORT}`);
});