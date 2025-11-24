import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Middleware para procesar JSON
app.use(express.json());

// Headers de seguridad que le gustan a CBB (Copiados de tu Worker)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "authorization, content-type");
  res.header("X-Frame-Options", "DENY");
  res.header("X-Content-Type-Options", "nosniff");
  res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// Ruta principal que CBB buscará
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  console.log(`📨 Recibido método: ${method}`);

  try {
    // 1. HANDSHAKE (Inicialización) - Sin Auth
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "unx_mcp_railway", version: "1.0.0" }
        }
      });
    }

    // 2. Notificación de inicializado - Sin respuesta necesaria
    if (method === "notifications/initialized") {
      return res.status(200).end();
    }

    // 3. LISTAR HERRAMIENTAS - Sin Auth (Generalmente)
    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "get_active_courses",
              description: "Obtiene lista de cursos activos PAA con precios base.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "get_course_details",
              description: "Obtiene detalle completo de un curso (fechas, precios exactos, links).",
              inputSchema: {
                type: "object",
                properties: {
                  keyword: { type: "string", description: "Ej: Integral, Exponencial" },
                  modality: { type: "string", description: "Ej: Presencial, Zoom" }
                },
                required: ["keyword"]
              }
            }
          ]
        }
      });
    }

    // 4. EJECUTAR HERRAMIENTAS - ¡AQUÍ SÍ PEDIMOS PASSWORD!
    if (method === "tools/call") {
      // Verificación de seguridad
      const authHeader = req.headers['authorization'] || "";
      const expectedToken = `Bearer ${process.env.MCP_API_KEY}`;
      
      // Si la clave no coincide, rechazamos
      if (authHeader !== expectedToken) {
        console.log("⛔ Error de Auth en tools/call");
        return res.status(401).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "Unauthorized" }
        });
      }

      const toolName = params.name;
      const args = params.arguments;
      
      console.log(`🔧 Ejecutando Tool: ${toolName}`);

      // Lógica de get_active_courses
      if (toolName === "get_active_courses") {
        const { data, error } = await supabase
          .from('courses')
          .select('name, modality, price_promo, start_date')
          .eq('status', 'active');
        
        if (error) throw new Error(error.message);

        const textResult = data.map(c => `- ${c.name} (${c.modality}): $${c.price_promo}. Inicio: ${c.start_date}`).join("\n");
        
        return res.json({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: textResult }] }
        });
      }

      // Lógica de get_course_details
      if (toolName === "get_course_details") {
        const { keyword, modality } = args;
        let query = supabase.from('courses').select('*').ilike('name', `%${keyword}%`).eq('status', 'active');
        
        if (modality) query = query.ilike('modality', `%${modality}%`);
        
        const { data, error } = await query.limit(1);

        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          return res.json({
            jsonrpc: "2.0", id,
            result: { content: [{ type: "text", text: "No se encontró información." }] }
          });
        }

        const c = data[0];
        const detail = `
CURSO: ${c.name} (${c.modality})
📅 Fechas: ${c.start_date} al ${c.end_date}
💰 Promo: $${c.price_promo} (Lista: $${c.price_list})
🔗 Link: ${c.purchase_url}
📝 ${c.description}
        `;

        return res.json({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: detail }] }
        });
      }

      throw new Error("Herramienta no encontrada");
    }

    // Método desconocido
    return res.status(404).json({ error: "Method not found" });

  } catch (error) {
    console.error("Error servidor:", error);
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: error.message }
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Híbrido UNX corriendo en puerto ${PORT}`);
});