import TelegramBot from 'node-telegram-bot-api';
import { EventEmitter } from 'events';

/**
 * TelegramBotClient — wraps node-telegram-bot-api.
 *
 * Di arsitektur normal, openclaw mengelola polling bot untuk respons AI.
 * Client ini dipakai untuk:
 *   - Mengirim pesan outbound (admin reply, follow-up dari BullMQ)
 *   - Mode polling alternatif (dev tanpa openclaw)
 *
 * Events: 'connected', 'disconnected', 'message', 'error'
 */
export class TelegramBotClient extends EventEmitter {
  #bot = null;
  #connected = false;

  /**
   * @param {string} botToken  - Telegram Bot API token
   * @param {object} options
   * @param {boolean} [options.polling=false] - Aktifkan polling (matikan jika openclaw sudah poll)
   */
  constructor(botToken, options = {}) {
    super();
    this._token = botToken;
    this._polling = options.polling ?? false;
  }

  /**
   * Inisialisasi koneksi bot.
   * Harus dipanggil sebelum sendMessage().
   * @returns {TelegramBotClient} this
   */
  initialize() {
    this.#bot = new TelegramBot(this._token, {
      polling: this._polling
        ? { interval: 2000, autoStart: true, params: { timeout: 10 } }
        : false,
    });

    if (this._polling) {
      this.#bot.on('message', (msg) => this.emit('message', msg));
      this.#bot.on('polling_error', (err) => {
        this.emit('error', err);
      });
    }

    this.#connected = true;
    this.emit('connected');
    return this;
  }

  /**
   * Kirim pesan teks ke chat Telegram.
   * @param {number|string} chatId - Telegram chat ID
   * @param {string} text - Teks pesan
   * @param {object} [options] - node-telegram-bot-api sendMessage options
   */
  async sendMessage(chatId, text, options = {}) {
    if (!this.#bot) throw new Error('Bot not initialized — panggil initialize() dulu');
    return this.#bot.sendMessage(chatId, text, options);
  }

  /**
   * Ambil info bot dari Telegram API (getMe).
   */
  async getMe() {
    if (!this.#bot) throw new Error('Bot not initialized');
    return this.#bot.getMe();
  }

  /**
   * Hentikan polling dan tutup koneksi.
   */
  async disconnect() {
    if (this._polling && this.#bot) {
      try {
        await this.#bot.stopPolling();
      } catch {
        // ignore penghentian yang gagal
      }
    }
    this.#connected = false;
    this.emit('disconnected');
  }

  get isConnected() {
    return this.#connected;
  }
}
