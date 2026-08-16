import { Tool, ToolContext } from '../../shared/types/tool.types';
import { saveArchive } from '../../shared/utils/archives';

export class RemoveBackgroundTool implements Tool {
  id = 'remove-background';
  name = 'Remove Background';
  icon = '';

  async execute(context: ToolContext): Promise<void> {
    // 選択中のレイヤーの画像、なければコンポジット画像を取得
    let targetCanvas = await context.getSelectedImage();
    let isComposite = false;
    
    if (!targetCanvas) {
      targetCanvas = await context.getCompositeImage();
      isComposite = true;
    }

    if (!targetCanvas) {
      throw new Error('No image available to process.');
    }

    // CanvasをBlobに変換
    const originBlob = await new Promise<Blob | null>(res => targetCanvas!.toBlob(res, 'image/png'));
    if (!originBlob) {
      throw new Error('Failed to extract image blob.');
    }

    // バックエンドへ送信
    const formData = new FormData();
    formData.append('image', originBlob, 'image.png');

    // CONFEITO_API_PORT (通常は48000か8000) で立ち上がっている想定だが
    // 開発サーバー等でプロキシされるため直接フェッチする (Viteがproxy設定しているはず)
    const response = await fetch('http://127.0.0.1:48000/api/image/remove-bg', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Background removal failed: ${errorText}`);
    }

    const resultBlob = await response.blob();

    // アーカイブ保存名の生成
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
    const folderName = `${dateStr}_${timeStr}_${this.id}`;

    const archiveFiles: {blob: Blob, path: string}[] = [];
    archiveFiles.push({blob: originBlob, path: 'origin.png'});
    archiveFiles.push({blob: resultBlob, path: 'nobg.png'});
    
    await saveArchive(folderName, archiveFiles);
    window.dispatchEvent(new Event('tool:cache-updated'));
  }
}
