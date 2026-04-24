import * as React from 'react';
import { Text, Button } from '@react-email/components';
import { EmailLayout } from './EmailLayout';

export interface UnitInvitationEmailProps {
    inviterName: string;
    inviteeName?: string;
    unitName: string;
    buildingName: string;
    acceptUrl: string;
    expiresAt: Date;
}

const headingStyle: React.CSSProperties = {
    fontSize: '22px',
    fontWeight: 700,
    color: '#111827',
    margin: '0 0 8px 0',
};

const bodyText: React.CSSProperties = {
    fontSize: '15px',
    color: '#374151',
    lineHeight: '1.6',
    margin: '0 0 16px 0',
};

const noteText: React.CSSProperties = {
    fontSize: '13px',
    color: '#6b7280',
    margin: '16px 0 0 0',
};

const buttonStyle: React.CSSProperties = {
    backgroundColor: '#1a56db',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    padding: '12px 28px',
    textDecoration: 'none',
    display: 'inline-block',
};

export function UnitInvitationEmail({
    inviterName,
    inviteeName,
    unitName,
    buildingName,
    acceptUrl,
    expiresAt,
}: UnitInvitationEmailProps) {
    const greeting = inviteeName ? `Hola ${inviteeName}` : 'Hola';
    const expiryStr = expiresAt.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });

    return (
        <EmailLayout preview={`${inviterName} te invita a unirte a ${buildingName}`}>
            <Text style={headingStyle}>{greeting} 👋</Text>
            <Text style={bodyText}>
                <strong>{inviterName}</strong> te ha invitado a unirte a la unidad <strong>{unitName}</strong> en
                el edificio <strong>{buildingName}</strong> a través de la plataforma <strong>Condominio</strong>.
            </Text>
            <Text style={bodyText}>
                Haz clic en el botón de abajo para completar tu solicitud de ingreso. El Miembro de Junta revisará
                tu solicitud y recibirás tus credenciales de acceso una vez aprobada.
            </Text>

            <Button href={acceptUrl} style={buttonStyle}>
                Aceptar invitación
            </Button>

            <Text style={noteText}>
                Esta invitación vence el <strong>{expiryStr}</strong>. Si no la solicitaste, simplemente ignora este mensaje.
            </Text>
        </EmailLayout>
    );
}
