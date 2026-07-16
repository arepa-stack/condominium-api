import * as React from 'react';
import {
    Html,
    Head,
    Body,
    Container,
    Section,
    Text,
    Hr,
    Preview,
} from '@react-email/components';

interface EmailLayoutProps {
    preview: string;
    children: React.ReactNode;
}

const containerStyle: React.CSSProperties = {
    maxWidth: '560px',
    margin: '0 auto',
    padding: '0 20px',
};

const headerStyle: React.CSSProperties = {
    backgroundColor: '#1a56db',
    borderRadius: '8px 8px 0 0',
    padding: '24px 32px',
};

const brandStyle: React.CSSProperties = {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    margin: 0,
};

const bodyContainerStyle: React.CSSProperties = {
    backgroundColor: '#ffffff',
    borderRadius: '0 0 8px 8px',
    padding: '32px',
    border: '1px solid #e5e7eb',
    borderTop: 'none',
};

const footerStyle: React.CSSProperties = {
    color: '#9ca3af',
    fontSize: '12px',
    textAlign: 'center',
    marginTop: '32px',
};

export function EmailLayout({ preview, children }: EmailLayoutProps) {
    return (
        <Html lang="es">
            <Head />
            <Preview>{preview}</Preview>
            <Body style={{ backgroundColor: '#f3f4f6', fontFamily: 'Inter, Arial, sans-serif', margin: 0, padding: '40px 0' }}>
                <Container style={containerStyle}>
                    <Section style={headerStyle}>
                        <Text style={brandStyle}>🏢 Apto</Text>
                    </Section>
                    <Section style={bodyContainerStyle}>
                        {children}
                    </Section>
                    <Hr style={{ borderColor: 'transparent', margin: '8px 0' }} />
                    <Text style={footerStyle}>
                        Este mensaje fue generado automáticamente. Por favor no responda a este correo.
                    </Text>
                </Container>
            </Body>
        </Html>
    );
}
