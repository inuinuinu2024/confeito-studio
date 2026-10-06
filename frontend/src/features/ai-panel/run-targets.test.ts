import { describe, expect, it } from 'vitest';
import { ToolNotReady } from '../../shared/types/tool';
import { batchSummary, planTargets, progressMessage, SELECT_IMAGE, stoppedSummary } from './run-targets';

const image = (key: string) => ({ key, name: key, width: 1, height: 1 });

describe('planTargets', () => {
  it('runs once per selected image by default', () => {
    expect(planTargets({}, [image('a'), image('b')]).map(t => t?.key)).toEqual(['a', 'b']);
  });

  it('warns without a selection', () => {
    expect(() => planTargets({}, [])).toThrow(new ToolNotReady(SELECT_IMAGE));
  });

  it('uses the targets of the tool', () => {
    expect(planTargets({ targets: () => [null] }, [])).toEqual([null]);
    expect(() => planTargets({ targets: () => [] }, [image('a')])).toThrow(ToolNotReady);
  });
});

describe('messages', () => {
  it('words the progress and the outcome', () => {
    expect(progressMessage(1, 5, image('p.png'))).toBe('(2/5) p.png');
    expect(progressMessage(0, 2, null)).toBe('(1/2)');
    expect(batchSummary(3, 3, 0)).toBe('3 件を処理しました');
    expect(batchSummary(5, 4, 1)).toBe('5 件中 4 件成功・1 件失敗しました');
    expect(stoppedSummary(5, 2)).toBe('実行を停止しました（5 件中 2 件完了）');
    expect(stoppedSummary(1, 0)).toBe('実行を停止しました');
  });
});
