import {
    Body,
    Button,
    Container,
    Head,
    Heading,
    Html,
    Preview,
    Text,
} from '@react-email/components';
import * as React from 'react';

interface WelcomeEmailProps {
    name: string;
    ctaUrl?: string;
}

export function WelcomeEmail({ name, ctaUrl = 'https://nibs-tech.com' }: WelcomeEmailProps) {
    return (
        <Html lang="es">
            <Head />
            <Preview>Bienvenido a Condominio, {name}</Preview>
            <Body style={bodyStyle}>
                <Container style={containerStyle}>
                    <Heading style={headingStyle}>Bienvenido, {name}</Heading>
                    <Text style={textStyle}>
                        Tu cuenta en Condominio ha sido creada exitosamente. Ya puedes acceder a la
                        aplicación y gestionar tu residencia de forma sencilla.
                    </Text>
                    <Button href={ctaUrl} style={buttonStyle}>
                        Comenzar ahora
                    </Button>
                    <Text style={footerStyle}>
                        Si tienes alguna pregunta, responde este correo y con gusto te ayudamos.
                    </Text>
                </Container>
            </Body>
        </Html>
    );
}

const bodyStyle: React.CSSProperties = {
    backgroundColor: '#f4f4f5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const containerStyle: React.CSSProperties = {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    margin: '40px auto',
    padding: '40px',
    maxWidth: '560px',
};

const headingStyle: React.CSSProperties = {
    color: '#18181b',
    fontSize: '24px',
    fontWeight: '700',
    marginBottom: '16px',
};

const textStyle: React.CSSProperties = {
    color: '#3f3f46',
    fontSize: '16px',
    lineHeight: '24px',
    marginBottom: '24px',
};

const buttonStyle: React.CSSProperties = {
    backgroundColor: '#2563eb',
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: '600',
    padding: '12px 24px',
    textDecoration: 'none',
};

const footerStyle: React.CSSProperties = {
    color: '#71717a',
    fontSize: '14px',
    lineHeight: '20px',
    marginTop: '32px',
};
