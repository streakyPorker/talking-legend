import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../App.js';

describe('App', () => {
  it('should render the game setup screen initially', () => {
    render(<App />);

    // GameSetup 中文页面
    expect(screen.getByText('传说之语')).toBeDefined();
    expect(screen.getByLabelText(/勇者，请留下你的名字/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /开启传奇/i })).toBeDefined();

    // 全局齿轮按钮始终存在
    expect(screen.getByRole('button', { name: /打开配置/i })).toBeDefined();
  });

  it('should toggle config screen via gear button', () => {
    render(<App />);

    // 初始时配置面板不可见
    expect(screen.queryByRole('dialog')).toBeNull();

    // 点击齿轮打开
    fireEvent.click(screen.getByRole('button', { name: /打开配置/i }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('heading', { name: /配置中心/i })).toBeDefined();
    expect(screen.getByLabelText('关闭')).toBeDefined();

    // 点击关闭按钮
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('should close config screen on Escape key', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /打开配置/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
