import { Component, inject, input, OnInit, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { MarkdownPipe } from '../../core/markdown.pipe';
import type { FileNode, FileProvenance, FileContent } from '../../core/models';

interface FlatFile {
  name: string;
  path: string;
  depth: number;
  size?: number;
  prov?: FileProvenance;
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

  readonly files = signal<FlatFile[]>([]);
  readonly provenance = signal<Record<string, FileProvenance>>({});
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
      const res = await this.api.files(this.workspaceId()).catch(() => ({ tree: [], provenance: {} }));
      this.provenance.set(res.provenance ?? {});
      this.files.set(this.flatten(res.tree ?? [], 0));
    } finally {
      this.loading.set(false);
    }
  }

  private flatten(nodes: FileNode[], depth: number): FlatFile[] {
    const out: FlatFile[] = [];
    for (const n of nodes) {
      if (n.type === 'dir') {
        out.push({ name: n.name, path: n.path, depth });
        out.push(...this.flatten(n.children ?? [], depth + 1));
      } else {
        out.push({ name: n.name, path: n.path, depth, size: n.size, prov: this.provenance()[n.path] });
      }
    }
    return out;
  }

  isDir(f: FlatFile): boolean {
    return f.size === undefined && !f.prov && !/\.[a-z0-9]+$/i.test(f.name);
  }

  async inspect(f: FlatFile) {
    if (this.isDir(f)) return;
    this.loadingFile.set(true);
    this.openFile.set(null);
    try {
      const c = await this.api.fileContent(this.workspaceId(), f.path).catch(() => null);
      this.openFile.set(c);
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
