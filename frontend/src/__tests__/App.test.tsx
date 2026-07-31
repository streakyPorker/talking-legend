import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App.js';

function renderApp(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('should render the game setup screen at /', () => {
    renderApp('/');
    expect(screen.getByText('传说之语')).toBeDefined();
  });

  it('should render config button on setup screen', () => {
    renderApp('/');
    expect(screen.getByRole('button', { name: /打开配置/i })).toBeDefined();
  });
});
