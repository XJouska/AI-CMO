"""上传文件校验与处理：按文件头判断真实类型、图片去除 EXIF、PDF 只提取文本。"""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.core.errors import AppError

ALLOWED_KINDS = ("image", "certificate", "catalog", "pdf")
MAX_PDF_PAGES = 60
MAX_PDF_TEXT = 60_000
Image.MAX_IMAGE_PIXELS = 40_000_000  # 防解压炸弹


class UploadRejected(AppError):
    status_code = 415
    code = "unsupported_file"


@dataclass
class ProcessedUpload:
    data: bytes
    mime: str
    sha256: str
    text: str


def sniff_mime(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    return None


_PIL_FORMAT = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


def strip_image_metadata(data: bytes, mime: str) -> bytes:
    """重新编码图片：丢弃 EXIF / XMP / ICC 以外的全部元数据，同时验证图片可解码。"""
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != _PIL_FORMAT[mime]:
                raise UploadRejected("文件内容与类型不符")
            image.load()
            if getattr(image, "n_frames", 1) > 1:
                image.seek(0)
            fmt = _PIL_FORMAT[mime]
            clean = image.convert("RGB") if fmt == "JPEG" and image.mode not in ("RGB", "L") else image.copy()
            out = io.BytesIO()
            save_kwargs: dict[str, object] = {}
            if fmt == "JPEG":
                save_kwargs = {"quality": 90, "optimize": True}
            elif fmt == "WEBP":
                save_kwargs = {"quality": 90}
            clean.save(out, format=fmt, **save_kwargs)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise UploadRejected("图片无法识别或已损坏") from exc


def extract_pdf_text(data: bytes) -> str:
    """只提取文本，不执行 PDF 中的任何脚本或嵌入内容。"""
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise UploadRejected("暂不支持加密的 PDF")
        parts: list[str] = []
        total = 0
        for page in reader.pages[:MAX_PDF_PAGES]:
            text = page.extract_text() or ""
            parts.append(text)
            total += len(text)
            if total >= MAX_PDF_TEXT:
                break
        return "\n".join(parts)[:MAX_PDF_TEXT]
    except UploadRejected:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError) as exc:
        raise UploadRejected("PDF 无法读取或已损坏") from exc


def process_upload(data: bytes, max_bytes: int) -> ProcessedUpload:
    if not data:
        raise AppError("文件为空", code="empty_file")
    if len(data) > max_bytes:
        raise AppError(
            f"文件不能超过 {max_bytes // (1024 * 1024)}MB", code="payload_too_large", status_code=413
        )
    mime = sniff_mime(data[:16])
    if mime is None:
        raise UploadRejected("只支持 JPG、PNG、WebP 图片和 PDF 文件")
    if mime == "application/pdf":
        text = extract_pdf_text(data)
        clean = data
    else:
        clean = strip_image_metadata(data, mime)
        text = ""
    return ProcessedUpload(data=clean, mime=mime, sha256=hashlib.sha256(clean).hexdigest(), text=text)


def display_name(filename: str | None) -> str:
    """仅用于界面显示：去掉路径和控制字符，限制长度。"""
    name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")
    name = re.sub(r"\s+", " ", name).strip()
    return name[:120] or "未命名文件"
