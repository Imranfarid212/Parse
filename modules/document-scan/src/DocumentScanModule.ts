import { NativeModule, requireNativeModule } from 'expo';

declare class DocumentScanModule extends NativeModule<{}> {}

export default requireNativeModule<DocumentScanModule>('DocumentScan');
