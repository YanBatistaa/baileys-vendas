import express from 'express';
import cors from 'cors';
import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion 
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';

const app = express();

// CORS - Liberar todas as origens (ou especifique as suas)
app.use(cors({
  origin: '*', // Permite qualquer origem (para produção, especifique seu domínio)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

let sock = null;
let qrCodeData = null;
let isConnected = false;

const logger = pino({ level: 'info' });

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger,
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeData = await QRCode.toDataURL(qr);
        logger.info('📱 QR Code gerado');
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.info(`❌ Conexão fechada. Reconectando: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(() => connectToWhatsApp(), 3000);
        }
        isConnected = false;
        qrCodeData = null;
      } else if (connection === 'open') {
        logger.info('✅ Conectado ao WhatsApp!');
        isConnected = true;
        qrCodeData = null;
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
      const msg = messages[0];
      if (!msg.key.fromMe && msg.message) {
        logger.info('📩 Nova mensagem recebida');
        // Aqui você pode enviar webhook para o Supabase
        // Exemplo: notificar que chegou nova mensagem
      }
    });
  } catch (error) {
    logger.error('❌ Erro ao conectar:', error);
    setTimeout(() => connectToWhatsApp(), 5000);
  }
}

// ===== ROTAS DA API =====

// Rota principal
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Baileys WhatsApp API',
    version: '1.0.0',
    connected: isConnected,
    message: 'API funcionando! Use /health para verificar status.'
  });
});

// Health check (para Coolify)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connected: isConnected,
    timestamp: new Date().toISOString()
  });
});

// Obter QR Code
app.get('/qr', (req, res) => {
  if (qrCodeData) {
    res.json({ 
      qr: qrCodeData, 
      status: 'qr_ready',
      message: 'Escaneie o QR Code com seu WhatsApp'
    });
  } else if (isConnected) {
    res.json({ 
      status: 'connected', 
      qr: null,
      message: 'WhatsApp já está conectado'
    });
  } else {
    res.json({ 
      status: 'connecting', 
      qr: null,
      message: 'Aguardando conexão...'
    });
  }
});

// Enviar mensagem
app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  
  if (!to || !message) {
    return res.status(400).json({ 
      error: 'Campos "to" e "message" são obrigatórios',
      example: { to: '5563999887766', message: 'Olá!' }
    });
  }

  if (!isConnected || !sock) {
    return res.status(503).json({ 
      error: 'WhatsApp não conectado. Gere o QR Code em /qr' 
    });
  }

  try {
    // Formatar número: remover caracteres especiais e adicionar @s.whatsapp.net
    const cleanPhone = to.replace(/\D/g, '');
    const formattedNumber = cleanPhone.includes('@s.whatsapp.net') 
      ? cleanPhone 
      : `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(formattedNumber, { text: message });
    
    logger.info(`✅ Mensagem enviada para ${formattedNumber}`);
    res.json({ 
      success: true,
      message: 'Mensagem enviada com sucesso',
      to: formattedNumber
    });
  } catch (error) {
    logger.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({ 
      error: 'Erro ao enviar mensagem',
      details: error.message 
    });
  }
});

// Status detalhado
app.get('/status', (req, res) => {
  res.json({ 
    connected: isConnected,
    hasQR: !!qrCodeData,
    uptime: process.uptime(),
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

// Desconectar (útil para testes)
app.post('/disconnect', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
      logger.info('🔌 WhatsApp desconectado');
    }
    res.json({ success: true, message: 'Desconectado com sucesso' });
  } catch (error) {
    logger.error('❌ Erro ao desconectar:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== INICIAR SERVIDOR =====

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Baileys API rodando na porta ${PORT}`);
  logger.info(`📡 Acesse: http://localhost:${PORT}`);
  logger.info(`🔗 Health: http://localhost:${PORT}/health`);
  logger.info(`📱 QR Code: http://localhost:${PORT}/qr`);
  connectToWhatsApp();
});
