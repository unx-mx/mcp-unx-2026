import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

dotenv.config();

// 1. Configuración Inicial
const app = express();
app.use(cors());

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
  {}, // No requiere parámetros de entrada
  async () => {
    const { data, error } = await supabase
      .from('courses')
      .select('name, modality, price_promo, start_date, schedule_summary')
      .eq('status', 'active');

    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    
    // Formateamos la respuesta para que sea fácil de leer por la IA
    const formatted = data.map(c => 
      `- ${c.name} (${c.modality}): Inicia ${c.start_date}. Promo: $${c.price_promo}. Horario: ${c.schedule_summary}`
    ).join("\n");

    return { content: [{ type: "text", text: `Cursos disponibles:\n${formatted}` }] };
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
    // Buscamos en la base de datos algo que coincida
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .ilike('name', `%${keyword}%`) // Busca coincidencia parcial en nombre
      .ilike('modality', `%${modality}%`) // Busca coincidencia parcial en modalidad
      .eq('status', 'active')
      .limit(1);

    if (error) return { content: [{ type: "text", text: `Error en base de datos: ${error.message}` }] };
    if (!data || data.length === 0) return { content: [{ type: "text", text: `No encontré información activa para el curso ${keyword} en modalidad ${modality}. Pide al usuario que especifique mejor.` }] };

    const course = data[0];
    
    const info = `
DETALLES DEL CURSO: ${course.name} (${course.modality})
----------------------------------------
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

// --- CONFIGURACIÓN DEL SERVIDOR HTTP (SSE) ---

// Endpoint para iniciar la conexión SSE (Server-Sent Events)
app.get('/sse', async (req, res) => {
  // Validación de seguridad simple
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (apiKey !== process.env.MCP_API_KEY) {
    res.status(401).send('Unauthorized: Invalid API Key');
    return;
  }

  console.log("Nueva conexión MCP establecida desde ChatbotBuilder");
  
  const transport = new SSEServerTransport("/messages", res);
  await mcpServer.connect(transport);
});

// Endpoint para recibir los mensajes (POST)
app.post('/messages', async (req, res) => {
  // Nota: En una implementación real de producción, deberíamos manejar sesiones, 
  // pero para este caso simple, Express y el SDK manejan el enrutamiento básico.
  // ChatbotBuilder enviará los mensajes a esta URL tras conectar por SSE.
  await mcpServer.processPostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor MCP UNX corriendo en puerto ${PORT}`);
  console.log(`📡 Endpoint SSE: http://localhost:${PORT}/sse`);
});