import QRCodeModule from "qrcode-terminal/vendor/QRCode/index.js";
import QRErrorCorrectLevelModule from "qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js";
import { encodePngRgba, fillPixel } from "./png-encode.ts";

type QRCodeConstructor = new (
  typeNumber: number,
  errorCorrectLevel: unknown,
) => {
  addData: (data: string) => void;
  make: () => void;
  getModuleCount: () => number;
  isDark: (row: number, col: number) => boolean;
};

const QRCode = QRCodeModule as QRCodeConstructor;
const QRErrorCorrectLevel = QRErrorCorrectLevelModule;

type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

function resolveQrErrorCorrectionLevel(level: QrErrorCorrectionLevel = "L") {
  const normalized = String(level || "L").trim().toUpperCase() as QrErrorCorrectionLevel;
  return QRErrorCorrectLevel[normalized] ?? QRErrorCorrectLevel.L;
}

function createQrMatrix(input: string, errorCorrectionLevel: QrErrorCorrectionLevel = "L") {
  const qr = new QRCode(-1, resolveQrErrorCorrectionLevel(errorCorrectionLevel));
  qr.addData(input);
  qr.make();
  return qr;
}

export async function renderQrPngBase64(
  input: string,
  opts: {
    scale?: number;
    marginModules?: number;
    targetSize?: number;
    errorCorrectionLevel?: QrErrorCorrectionLevel;
  } = {},
): Promise<string> {
  const {
    scale = 6,
    marginModules = 4,
    targetSize,
    errorCorrectionLevel = "L",
  } = opts;
  const qr = createQrMatrix(input, errorCorrectionLevel);
  const modules = qr.getModuleCount();
  const safeMarginModules = Number.isFinite(marginModules)
    ? Math.max(0, Math.round(marginModules))
    : 4;
  const safeScale = Number.isFinite(scale)
    ? Math.max(1, Math.round(scale))
    : 6;
  const scaleFromTargetSize = Number.isFinite(targetSize)
    ? Math.max(1, Math.ceil(Number(targetSize) / (modules + safeMarginModules * 2)))
    : 0;
  const pixelScale = Math.max(safeScale, scaleFromTargetSize);
  const size = (modules + safeMarginModules * 2) * pixelScale;

  const buf = Buffer.alloc(size * size * 4, 255);
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!qr.isDark(row, col)) {
        continue;
      }
      const startX = (col + safeMarginModules) * pixelScale;
      const startY = (row + safeMarginModules) * pixelScale;
      for (let y = 0; y < pixelScale; y += 1) {
        const pixelY = startY + y;
        for (let x = 0; x < pixelScale; x += 1) {
          const pixelX = startX + x;
          fillPixel(buf, pixelX, pixelY, size, 0, 0, 0, 255);
        }
      }
    }
  }

  const png = encodePngRgba(buf, size, size);
  return png.toString("base64");
}
