import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

/**
 * Renderiza Markdown a HTML seguro para el dashboard.
 * Usa `marked` para parsear y el DomSanitizer de Angular para evitar XSS
 * (el contenido viene de los agentes, se trata como no confiable).
 */
@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';
    const html = marked.parse(value, { async: false, gfm: true, breaks: true }) as string;
    // sanitize() elimina scripts/handlers peligrosos antes de inyectar.
    return this.sanitizer.sanitize(1 /* SecurityContext.HTML */, html) ?? '';
  }
}
