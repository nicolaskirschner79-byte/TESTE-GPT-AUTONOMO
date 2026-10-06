export const viewFromPath = pathname => pathname === '/meus-agendamentos' || pathname === '/meus-agendamentos/' ? 'history' : 'booking';
export const viewPath = view => view === 'history' ? '/meus-agendamentos' : '/';
