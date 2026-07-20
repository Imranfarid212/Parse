import { registerWebModule, NativeModule } from 'expo';

class DocumentScanModule extends NativeModule<{}> {}

export default registerWebModule(DocumentScanModule, 'DocumentScanModule');
