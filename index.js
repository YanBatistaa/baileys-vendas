import express from 'express';
import cors from 'cors';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { Boom } from '@hapi/boom';
import pino from 'pino';

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let qrCodeData = null;
let isConnected = false;

const logger = pino({ level: 'info' });

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = await QRCode.toDataURL(qr);
      logger.info('QR Code gerado');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info(`Conexão fechada. Reconectando: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 3000);
      }
      isConnected = false;
      qrCodeData = null;
    } else if (connection === 'open') {
      logger.info('Conectado ao WhatsApp!');
      isConnected = true;
      qrCodeData = null;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.key.fromMe && msg.message) {
      logger.info('Nova mensagem recebida');
      // Aqui você pode enviar webhook para o Supabase
    }
  });
}

// Rotas da API
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connected: isConnected });
});

app.get('/qr', (req, res) => {
  if (qrCodeData) {
    res.json({ qr: qrCodeData, status: 'qr_ready' });
  } else if (isConnected) {
    res.json({ status: 'connected', qr: null });
  } else {
    res.json({ status: 'connecting', qr: null });
  }
});

app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  
  if (!isConnected) {
    return res.status(503).json({ error: 'WhatsApp não conectado' });
  }

  try {
    const formattedNumber = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
    await sock.sendMessage(formattedNumber, { text: message });
    res.json({ success: true });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    connected: isConnected,
    hasQR: !!qrCodeData 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Baileys API rodando na porta ${PORT}`);
  connectToWhatsApp();
});
