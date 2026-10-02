// ==============================================================================
//  Relay SMTP -> API HTTPS de Resend
//
//  Railway bloquea el SMTP saliente en los planes Free/Trial/Hobby, pero no
//  el HTTPS. Este servicio escucha SMTP en la red privada del proyecto y
//  reenvía cada mensaje por la API de Resend.
//
//  SEGURIDAD: escucha solo en la red privada de Railway. NO generes un
//  dominio público para este servicio: un relay SMTP abierto a internet
//  acaba enviando spam en cuestión de horas.
// ==============================================================================

import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

const PORT = parseInt(process.env.PORT || "2525", 10);
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEFAULT_FROM = process.env.DEFAULT_FROM || "";

if (!RESEND_API_KEY) {
  console.error("[relay] Falta RESEND_API_KEY");
  process.exit(1);
}

async function sendViaResend(parsed) {
  const payload = {
    from: parsed.from?.text || DEFAULT_FROM,
    to: parsed.to?.value?.map((a) => a.address) || [],
    subject: parsed.subject || "(sin asunto)",
  };

  if (parsed.html) payload.html = parsed.html;
  if (parsed.text) payload.text = parsed.text;
  if (!payload.html && !payload.text) payload.text = "";

  if (parsed.attachments?.length) {
    payload.attachments = parsed.attachments.map((a) => ({
      filename: a.filename || "attachment",
      content: a.content.toString("base64"),
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  return body;
}

const server = new SMTPServer({
  // Sin TLS ni auth: el tráfico no sale de la red privada de Railway.
  secure: false,
  disabledCommands: ["STARTTLS", "AUTH"],
  authOptional: true,
  size: 25 * 1024 * 1024,

  onData(stream, session, callback) {
    simpleParser(stream)
      .then(async (parsed) => {
        const to = parsed.to?.text || "?";
        console.log(`[relay] -> ${to} | ${parsed.subject || "(sin asunto)"}`);
        try {
          await sendViaResend(parsed);
          console.log(`[relay] OK ${to}`);
          callback();
        } catch (err) {
          console.error(`[relay] FALLO ${to}: ${err.message}`);
          callback(new Error("Resend rejected the message"));
        }
      })
      .catch((err) => {
        console.error(`[relay] Error parseando: ${err.message}`);
        callback(new Error("Parse error"));
      });
  },
});

server.on("error", (err) => console.error(`[relay] Error SMTP: ${err.message}`));

server.listen(PORT, "::", () => {
  console.log(`[relay] Escuchando SMTP en el puerto ${PORT} (red privada)`);
});
