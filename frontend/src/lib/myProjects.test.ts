import { describe, expect, it } from 'vitest';
import {
  MAX_MY_PROJECTS,
  MY_PROJECTS_KEY,
  findMyProject,
  myProjectSettings,
  readMyProjects,
  removeMyProject,
  saveAsMyProject,
  saveMyProjects,
} from './myProjects';
import { DEFAULT_PRINT } from './printPlan';

const storage = (value: string | null) => ({ getItem: () => value });

describe('my projects', () => {
  it('saves settings under a name, newest first, replacing the same name', () => {
    const tag = {
      ...DEFAULT_PRINT,
      project: 'keychain' as const,
      widthMm: 35,
      colorRaise: { 0: 2 },
    };
    let projects = saveAsMyProject([], '  Dog tag ', tag);
    projects = saveAsMyProject(projects, 'Coaster', { ...DEFAULT_PRINT, widthMm: 90 });
    projects = saveAsMyProject(projects, 'dog TAG', { ...tag, widthMm: 30 });

    expect(projects.map((project) => project.name)).toEqual(['dog TAG', 'Coaster']);
    expect(findMyProject(projects, 'Dog tag')?.name).toBe('dog TAG');
    // Applied as custom settings, without the design's color raises.
    expect(myProjectSettings(projects[0])).toMatchObject({ widthMm: 30, project: 'custom' });
    expect(myProjectSettings(projects[0])).not.toHaveProperty('colorRaise');
    expect(removeMyProject(projects, 'Coaster').map((project) => project.name)).toEqual([
      'dog TAG',
    ]);
  });

  it('keeps at most a dozen projects and shortens long names', () => {
    let projects = saveAsMyProject([], 'x'.repeat(60), DEFAULT_PRINT);
    expect(projects[0].name).toHaveLength(40);
    for (let index = 0; index < 20; index += 1) {
      projects = saveAsMyProject(projects, `Project ${index}`, DEFAULT_PRINT);
    }
    expect(projects).toHaveLength(MAX_MY_PROJECTS);
    expect(projects[0].name).toBe('Project 19');
  });

  it('reads stored projects and leaves out unreadable ones', () => {
    const good = saveAsMyProject([], 'Magnet', DEFAULT_PRINT)[0];
    const stored = JSON.stringify([good, { name: 'Broken', preset: '{}' }, { name: 3 }, null]);

    expect(readMyProjects(storage(stored))).toEqual([good]);
    expect(readMyProjects(storage('not json'))).toEqual([]);
    expect(readMyProjects(storage('{"name": "x"}'))).toEqual([]);
    expect(readMyProjects(undefined)).toEqual([]);

    const saved = new Map<string, string>();
    saveMyProjects({ setItem: (key, value) => saved.set(key, value) }, [good]);
    expect(readMyProjects(storage(saved.get(MY_PROJECTS_KEY)!))).toEqual([good]);
    expect(() =>
      saveMyProjects(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        [good],
      ),
    ).not.toThrow();
  });
});
