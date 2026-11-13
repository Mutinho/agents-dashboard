import { Component, inject, input, OnInit, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { MarkdownPipe } from '../../core/markdown.pipe';
import type { FileContent } from '../../core/models';

interface Artifact {
  path: string;
  size: number;
  conversationId: string | null;
  action: string;
  ts: string;
}

@Component({
  selector: 'app-file-explorer',
  imports: [RouterLink, MarkdownPipe],
  templateUrl: './file-explorer.html',
  styleUrl: './file-explorer.scss',
})
export class FileExplorer implements OnInit {
  readonly workspaceId = input.required<string>();

  private api = inject(ApiService);

  readonly artifacts = signal<Artifact[]>([]);
  readonly loading = signal(true);

  // modal inspector
  readonly openFile = signal<FileContent | null>(null);
  readonly loadingFile = signal(false);

  readonly isMarkdown = computed(() => {
    const f = this.openFile();
    return !!f && (f.language === 'md' || f.path.toLowerCase().endsWith('.md'));
  });

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    this.loading.set(true);
    try {
      const res = await this.api.files(this.workspaceId()).catch(() => ({ files: [] as Artifact[] }));
      this.artifacts.set(res.files ?? []);
    } finally {
      this.loading.set(false);
    }
  }

  async inspect(a: Artifact) {
    this.loadingFile.set(true);
    this.openFile.set(null);
    try {
      this.openFile.set(await this.api.fileContent(this.workspaceId(), a.path).catch(() => null));
    } finally {
      this.loadingFile.set(false);
    }
  }

  close() { this.openFile.set(null); }

  downloadUrl(path: string): string {
    return this.api.downloadUrl(this.workspaceId(), path);
  }

  fmtSize(bytes?: number): string {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  convShort(id: string | null): string {
    return id ? id.slice(0, 12) : '';
  }
}
