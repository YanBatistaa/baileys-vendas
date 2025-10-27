import express from 'express';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { Boom } from '@hapi/boom';

const app = express();
app.use(express.json());

let sock = null;
let qrCodeData = null;
let isConnected = false;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = await QRCode.toDataURL(qr);
      console.log('QR Code gerado!');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão fechada. Reconectando...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
      isConnected = false;
    } else if (connection === 'open') {
      console.log('Conectado ao WhatsApp!');
      isConnected = true;
      qrCodeData = null;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe && msg.message) {
      console.log('Nova mensagem:', msg);
      // Webhook aqui para notificar o Supabase
    }
  });
}

// API Endpoints
app.get('/qr', (req, res) => {
  if (qrCodeData) {
    res.json({ qr: qrCodeData });
  } else if (isConnected) {
    res.json({ status: 'connected' });
  } else {
    res.json({ status: 'connecting' });
  }
});

app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  try {
    await sock.sendMessage(`${to}@s.whatsapp.net`, { text: message });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ connected: isConnected });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Baileys API rodando na porta ${PORT}`);
  connectToWhatsApp();
});
