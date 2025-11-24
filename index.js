import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.json());

// Headers de seguridad (Indispensables para CBB)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "authorization, content-type");
  next();
});

// Constante: Definimos el calendario actual para filtrar precios viejos
const CURRENT_CALENDAR = "2026B"; 

app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  try {
    // 1. HANDSHAKE
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "unx_mcp_advanced", version: "2.0.0" }
        }
      });
    }

    if (method === "notifications/initialized") return res.status(200).end();

    // 2. LISTAR HERRAMIENTAS
    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          tools: [
            {
              name: "get_active_courses",
              description: "Lista los cursos PAA activos. Úsala para dar info general.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "get_course_details",
              description: "Obtiene precio, horarios, fechas e imagen de un curso específico.",
              inputSchema: {
                type: "object",
                properties: {
                  keyword: { type: "string", description: "Nombre del curso (Integral, Exponencial)" },
                  modality: { type: "string", description: "Modalidad (Presencial, Zoom)" }
                },
                required: ["keyword"]
              }
            },
            {
              name: "recommend_course",
              description: "Recomienda un curso basado en la carrera o universidad.",
              inputSchema: {
                type: "object",
                properties: {
                  career: { type: "string", description: "Carrera deseada (Medicina, Arquitectura)" }
                },
                required: ["career"]
              }
            }
          ]
        }
      });
    }

    // 3. EJECUTAR HERRAMIENTAS
    if (method === "tools/call") {
      // Auth Check
      const authHeader = req.headers['authorization'] || "";
      if (authHeader !== `Bearer ${process.env.MCP_API_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const toolName = params.name;
      const args = params.arguments;

      // --- TOOL: RECOMENDAR CURSO (careers_map) ---
      if (toolName === "recommend_course") {
        const { data, error } = await supabase
          .from('careers_map')
          .select('recommended_course_id, career')
          .ilike('career', `%${args.career}%`)
          .limit(1);

        if (error || !data.length) {
          return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "No encontré una recomendación específica, pero el curso Integral suele ser la mejor opción general." }] } });
        }

        // Ahora buscamos el nombre bonito del curso recomendado
        const courseInfo = await supabase.from('courses').select('name').eq('id', data[0].recommended_course_id).single();
        const courseName = courseInfo.data ? courseInfo.data.name : data[0].recommended_course_id;

        return res.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: `Para la carrera de ${data[0].career}, recomendamos el curso: ${courseName}.` }] }
        });
      }

      // --- TOOL: LISTAR CURSOS (courses) ---
      if (toolName === "get_active_courses") {
        const { data, error } = await supabase
          .from('courses')
          .select('name, category, duration_label')
          .eq('active', true)
          .eq('category', 'PAA'); // Filtramos solo PAA

        if (error) throw error;

        const list = data.map(c => `🔹 ${c.name} (${c.duration_label})`).join("\n");
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Cursos PAA Disponibles:\n${list}` }] } });
      }

      // --- TOOL: DETALLE COMPLETO (JOIN DE 4 TABLAS) ---
      if (toolName === "get_course_details") {
        const { keyword, modality } = args;

        // 1. Buscar el ID del curso
        const { data: courses, error: errCourse } = await supabase
          .from('courses')
          .select('*')
          .ilike('name', `%${keyword}%`)
          .eq('active', true)
          .limit(1);

        if (errCourse || !courses.length) {
          return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "No encontré ese curso activo." }] } });
        }
        const course = courses[0];

        // 2. Buscar Precios (Tabla 'pricing')
        let priceQuery = supabase.from('pricing').select('*').eq('course_id', course.id).eq('calendar', CURRENT_CALENDAR);
        if (modality) priceQuery = priceQuery.ilike('modality', `%${modality}%`);
        const { data: prices } = await priceQuery.limit(1);
        const priceInfo = prices && prices.length > 0 ? prices[0] : null;

        // 3. Buscar Horarios (Tabla 'sessions')
        let sessionQuery = supabase.from('sessions').select('*').eq('course_id', course.id).eq('calendar', CURRENT_CALENDAR);
        if (modality) sessionQuery = sessionQuery.ilike('modality', `%${modality}%`);
        const { data: sessions } = await sessionQuery.limit(1);
        const sessionInfo = sessions && sessions.length > 0 ? sessions[0] : null;

        // 4. Buscar Imagen (Tabla 'course_media')
        const { data: media } = await supabase.from('course_media').select('url').eq('course_id', course.id).eq('kind', 'image_main').limit(1);
        const imageUrl = media && media.length > 0 ? media[0].url : "https://unx.mx";

        // Armar la respuesta de texto plano bonita
        const responseText = `
🎓 DETALLES: ${course.name}
-----------------------------
🗓️ Duración: ${course.duration_label}
📍 Modalidad: ${priceInfo ? priceInfo.modality : modality || "General"}
📅 Fechas: ${sessionInfo ? sessionInfo.start_date + ' al ' + sessionInfo.end_date : "Por confirmar"}

💰 PRECIOS (Calendario ${CURRENT_CALENDAR})
Precio Lista: $${priceInfo ? priceInfo.list_price : "---"}
🔥 Precio Promo: $${priceInfo ? priceInfo.promo_price : "---"}
⚠️ Vigencia Promo: Hasta ${priceInfo ? priceInfo.valid_until : "agotar existencias"}
💸 Apartado: $${priceInfo ? priceInfo.reserve_amount : "---"}

⏰ HORARIOS
${sessionInfo ? sessionInfo.schedule_label : "Consultar en web"}

🔗 Link de Compra: https://unx.mx/modalidades-paa/
🖼️ Ver imagen: ${imageUrl}
        `;

        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: responseText }] } });
      }

      return res.status(404).json({ error: "Method not found" });
    }
  } catch (e) {
    console.error(e);
    return res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor UNX (Multitabla) corriendo en ${PORT}`);
});