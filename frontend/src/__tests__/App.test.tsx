import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App.js';

/** 用 MemoryRouter 包裹 App，因为 App 现在使用 React Router */
function renderApp(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('should render the game setup screen initially', () => {
    renderApp('/');

    // GameSetup 中文页面
    expect(screen.getByText('传说之语')).toBeDefined();
    expect(screen.getByLabelText(/勇者，请留下你的名字/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /开启传奇/i })).toBeDefined();

    // 配置齿轮按钮在 GameSetup 页面中存在
    expect(screen.getByRole('button', { name: /打开配置/i })).toBeDefined();
  });

  it('should toggle config screen via gear button', () => {
    renderApp('/');

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
    renderApp('/');

    fireEvent.click(screen.getByRole('button', { name: /打开配置/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('should render setup at / route', () => {
    renderApp('/');
    // 首页应显示 GameSetup
    expect(screen.getByText('传说之语')).toBeDefined();
  });
});
